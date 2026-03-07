#
# Copyright (c) 2025–2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""simple-chatbot - Pipecat Voice Agent

This module implements a chatbot using Groq for natural language
processing. It includes:
- Real-time audio/video interaction through Daily
- Animated robot avatar
- Text-to-speech using ElevenLabs

The bot runs as part of a pipeline that processes audio/video frames and manages
the conversation flow.

Required AI services:
- Deepgram (Speech-to-Text)
- Groq (LLM)
- ElevenLabs (Text-to-Speech)

Run the bot using::

    uv run bot.py
"""

import os

from dotenv import load_dotenv
from loguru import logger
from PIL import Image
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    LLMRunFrame,
    OutputImageRawFrame,
    SpriteFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.types import DailyRunnerArguments, RunnerArguments, SmallWebRTCRunnerArguments
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.groq.llm import GroqLLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
import json

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

sprites = []
script_dir = os.path.dirname(__file__)

#Load Sequestial Animation Frames
for i in range(1,26):
    #Build the full path to the image file
    full_path = os.path.join(script_dir, f"assets/robot0{i}.png")
    #Get the filename without the extension to use as the dictionary key
    #Open the image file and convert it to bytes
    with Image.open(full_path) as img:
        sprites.append(OutputImageRawFrame(image=img.tobytes(), size=img.size, format=img.format))

#Create a smooth animation by adding repeated frames
flipped = sprites[::-1]
sprites.extend(flipped)

# Define static and animated states
quiet_frame = sprites[0]  # The first frame is the quiet state
talking_frame = SpriteFrame(images=sprites)  # Animated talking state


class TalkingAnimation(FrameProcessor):
    """Manages the bot's visual animation states.

    Switches between static (listening) and animated (talking) states based on
    the bot's current speaking status.
    """
   
    def __init__(self):
        super().__init__()
        self._is_talking = False
        
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Process incoming frames and update animation state.

        Args:
            frame: The incoming frame to process
            direction: The direction of frame flow in the pipeline
        """
        await super().process_frame(frame, direction)

        #Switch to talking animation when the bot starts speaking
        if isinstance(frame, BotStartedSpeakingFrame):
            if not self._is_talking:
                await self.push_frame(talking_frame)
                self._is_talking = True
        #Return to static frame when the bot stops speaking
        elif isinstance(frame, BotStoppedSpeakingFrame):
            await self.push_frame(quiet_frame)
            self._is_talking = False

        await self.push_frame(frame, direction)

def get_config_file_path()->str:
    script_dir = os.path.dirname(__file__)
    return os.path.join(script_dir, "interview_config.json")

def load_interview_config()->dict:
    config_file = get_config_file_path()
    default_config = {"botNature":"decent","experienceLevel":"3_5","JD":""}

    try:
        if os.path.exists(config_file):
            with open(config_file, 'r', encoding="utf-8") as f:
                config = json.load(f)
                #Validate and sanitise config
                bot_nature = config.get("botNature", "decent")
                if bot_nature not in ["friendly", "decent", "strict"]:
                    logger.warning(f"Invalid botNature '{bot_nature}' in config. Defaulting to 'decent'.")
                    bot_nature = "decent"
                jd = config.get("JD", "")
                resume = config.get("resume", "")
                logger.info(f"Loaded config - Nature: {bot_nature}, JD: {len(jd)} chars, Resume: {len(resume)} chars")
                exp_level = config.get("experienceLevel", "3_5")
                if exp_level not in ("fresher", "0_2", "3_5", "5_10", "10_plus"):
                    exp_level = "3_5"
                return {"botNature": bot_nature, "experienceLevel": exp_level, "JD": jd, "resume": resume}
        else:
            logger.info("Config file not found. Using default configuration.")
            return default_config
    except json.JSONDecodeError as e:
        logger.error(f"Error decoding JSON config file: {e}, using default config.")
        return default_config
    
def save_interview_config(bot_nature:str, jd:str)-> bool:
    config_file = get_config_file_path()
    if bot_nature not in ["friendly", "decent", "strict"]:
        logger.warning(f"Invalid botNature '{bot_nature}', defaulting to 'decent'.")
        bot_nature = "decent"
    config = {
        "botNature": bot_nature, 
        "JD": jd
    }

    try:
        with open(config_file, 'w', encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        logger.info("Interview configuration saved successfully.")
        return True
    except Exception as e:
        logger.error(f"Error saving interview config: {e}")
        return False

def build_system_prompt(bot_nature: str = "decent", experience_level: str = "3_5", jd: str = "", resume: str = "") -> str:
    """Build system prompt based on bot nature, experience level, and job description."""
    #Limit JD to 1500 characters to manage context window
    MAX_JD_LENGTH = 1500
    if len(jd) > MAX_JD_LENGTH:
        jd = jd[:MAX_JD_LENGTH] + "... [truncated]"
        logger.warning(f"JD truncated to {MAX_JD_LENGTH} characters")

    #Define nature-based personality traits
    nature_traits = {
        "friendly": {
            "tone": "warm, encouraging, and supportive",
            "approach": "Ask questions in a conversational and friendly manner. Be empathetic and make the candidate feel comfortable.",
            "feedback": "Provide positive reinforcement and constructive feedback."
        },
        "decent": {
            "tone": "professional, balanced, and respectful",
            "approach": "Ask questions in a professional and fair manner. Maintain a neutral but engaging tone.",
            "feedback": "Provide balanced feedback and maintain professional standards."
        },
        "strict": {
            "tone": "formal, direct, and challenging",
            "approach": "Ask questions in a rigorous and demanding manner. Challenge the candidate appropriately and expect detailed answers.",
            "feedback": "Be direct and hold high standards. Provide critical but fair feedback."
        }
    }
    traits = nature_traits.get(bot_nature.lower(), nature_traits["decent"])

    experience_traits = {
        "fresher": {
            "label": "a fresher with no prior work experience",
            "calibration": "Ask foundational questions covering core concepts, fundamentals, and basic problem-solving. Avoid expecting production experience. Be encouraging and patient — explain what a good answer looks like if the candidate is unsure.",
        },
        "0_2": {
            "label": "a junior candidate with 0–2 years of experience",
            "calibration": "Ask beginner-to-intermediate questions. Expect some hands-on exposure but not deep expertise. Focus on fundamentals, basic design patterns, and common tools. Allow room for learning on the job.",
        },
        "3_5": {
            "label": "a mid-level candidate with 3–5 years of experience",
            "calibration": "Ask intermediate questions that test solid understanding and real-world application. Expect familiarity with best practices, design patterns, and the ability to work independently. Probe for ownership and problem-solving depth.",
        },
        "5_10": {
            "label": "a senior candidate with 5–10 years of experience",
            "calibration": "Ask advanced questions that test architectural thinking, system design, performance optimization, and leadership. Expect the candidate to have led projects, mentored others, and made significant technical decisions.",
        },
        "10_plus": {
            "label": "a principal or lead-level candidate with 10+ years of experience",
            "calibration": "Ask strategic and architectural questions. Expect expertise in system design at scale, cross-team collaboration, technical vision, and the ability to influence engineering culture. Challenge assumptions and probe for trade-off reasoning.",
        },
    }
    exp = experience_traits.get(experience_level, experience_traits["3_5"])

    #Build the system prompt
    base_prompt = f"""You are an AI interviewer named Alex conducting a professional job interview. Your personality is {traits['tone']}. {traits['approach']} {traits['feedback']}.

CANDIDATE EXPERIENCE LEVEL: The candidate is {exp['label']}. {exp['calibration']}

YOUR IDENTITY — this is absolute and non-negotiable:
- Your name is ALEX. Say "I'm Alex" when you introduce yourself. No other name is acceptable.
- You are the INTERVIEWER. The human you are talking to is the CANDIDATE.
- Do NOT use any name from the candidate's resume as your own name under any circumstances.
- Do NOT say "My name is Rachel" or any name other than Alex. Ever.

CRITICAL RESPONSE RULES — follow these strictly every single turn:
- NEVER repeat, echo, paraphrase, or summarize what the candidate just said
- Do NOT start your response with phrases like "That's great", "I see", "So you mentioned", "You said that", "It sounds like you", "Thank you for sharing" or any form of acknowledgement that restates their answer
- React with at most 2-3 words of natural acknowledgement (e.g. "Interesting." or "Got it." or "Understood.") then immediately move to your next question or comment
- Ask ONE question at a time — never combine multiple questions
- Keep responses concise and direct, like a real interviewer
- Your output is converted to speech — never use markdown, bullet points, special characters, or asterisks
- Maintain natural interview pacing — if the candidate pauses briefly, wait; do not rush them
- Start by introducing yourself as Alex and the interview format in 1-2 sentences, then ask the first question"""
    
    if jd:
        jd_section = f"""

Job Description:
{jd}

Based on this job description, assess the candidate's:
- Relevant technical skills and experience
- Alignment with the role requirements
- Problem-solving approach
- Communication and collaboration abilities

Ask questions that evaluate these aspects in relation to the job requirements."""
        base_prompt += jd_section
    
    if resume:
        MAX_RESUME_LENGTH = 2000
        if len(resume) > MAX_RESUME_LENGTH:
            resume = resume[:MAX_RESUME_LENGTH] + "... [truncated]"
            logger.warning("Resume truncated to 2000 characters")
        resume_section = f"""

CANDIDATE'S RESUME (this belongs to the person you are interviewing — not you):
{resume}

Based on this resume, you should:
- Ask about specific projects and experiences mentioned in the resume
- Probe deeper into their relevant work history and achievements
- Ask about specific technologies, tools, and skills they have listed
- Validate claims and dig into measurable outcomes of their work
- Connect their past experience to the requirements of the role
- NEVER use the candidate's name from the resume as your own name"""
        base_prompt += resume_section

    base_prompt += "\n\nStart the interview by introducing yourself briefly and asking the first question."

    return base_prompt

async def run_bot(transport: BaseTransport, bot_nature:str = "decent", jd:str = ""):
    """Main Bot Logic."""

    config = load_interview_config()
    bot_nature = config.get("botNature", bot_nature)
    experience_level = config.get("experienceLevel", "3_5")
    jd = config.get("JD", jd)
    resume = config.get("resume", "")

    logger.info("Starting bot")
    logger.info(f"Bot nature: {bot_nature}, JD length: {len(jd)} characters")
    # Speech-to-Text Service
    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))

    #Text-to-Speech Service
    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        voice_id="a0e99841-438c-4a64-b679-ae501e7d6091",  # Barbershop Man — professional male
    )

    #LLM Service
    llm = GroqLLMService(api_key=os.getenv("GROQ_API_KEY"))

    system_prompt = build_system_prompt(bot_nature, experience_level, jd, resume)
    logger.info(system_prompt)


    messages = [
        {
            "role": "system", 
            "content": system_prompt
            },
    ]

    # Set up conversation context and management
    # The context_aggregator will automatically collect conversation context
    context = LLMContext(messages)
    context_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VADParams(
                stop_secs=3.0,    # wait 3 s of silence before sending to LLM
                confidence=0.8,   # higher threshold — ignores echo/noise after bot speaks
            )),
        ),
    )

    ta = TalkingAnimation()

    #Pipeline - assembled from reusable components
    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            ta,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    # Queue initial static frame so video starts immediately
    await task.queue_frame(quiet_frame)

    @task.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        #Kick off the conversation
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info(f"Client connected")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info(f"Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)

async def bot(runner_args: RunnerArguments):
    """Main bot entry point."""

    transport = None
    match runner_args:
        case DailyRunnerArguments():
            from pipecat.transports.daily.transport import DailyParams, DailyTransport

            transport = DailyTransport(
                runner_args.room_url,
                runner_args.token,
                "Pipecat Bot",
                params=DailyParams(
                    audio_in_enabled=True,
                    audio_out_enabled=True,
                    video_out_enabled=True,
                    video_out_width=1024,
                    video_out_height=576,
                ),
            )
        case SmallWebRTCRunnerArguments():
            webrtc_connection: SmallWebRTCConnection = runner_args.webrtc_connection

            transport = SmallWebRTCTransport(
                webrtc_connection = webrtc_connection,
                params=TransportParams(
                    audio_in_enabled=True,
                    audio_out_enabled=True,
                    video_out_enabled=True,
                    video_out_width=1024,
                    video_out_height=576,
                ),
            )
        case _:
            logger.error(f"Unsupported runner arguments type: {type(runner_args)}") 
            return
        
    await run_bot(transport)


if __name__ == "__main__":
    import argparse
    import time
    import httpx
    import uvicorn
    from fastapi import FastAPI, BackgroundTasks, Request
    from fastapi.responses import JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    from pipecat.transports.daily.transport import DailyParams, DailyTransport

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def health():
        return {"status": "ok"}

    @app.post("/start")
    async def start_endpoint(background_tasks: BackgroundTasks):
        daily_api_key = os.getenv("DAILY_API_KEY", "")
        if not daily_api_key:
            logger.error("DAILY_API_KEY not set")
            return JSONResponse({"error": "DAILY_API_KEY not configured"}, status_code=500)

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # Create Daily room
                r = await client.post(
                    "https://api.daily.co/v1/rooms",
                    headers={"Authorization": f"Bearer {daily_api_key}"},
                    json={"properties": {"start_video_off": True, "exp": int(time.time()) + 3600}},
                )
                if r.status_code != 200:
                    logger.error(f"Room creation failed: {r.text}")
                    return JSONResponse({"error": "Room creation failed", "detail": r.text}, status_code=500)
                room = r.json()
                room_url = room["url"]
                room_name = room["name"]
                logger.info(f"Created Daily room: {room_url}")

                # Bot token (owner)
                r = await client.post(
                    "https://api.daily.co/v1/meeting-tokens",
                    headers={"Authorization": f"Bearer {daily_api_key}"},
                    json={"properties": {"room_name": room_name, "is_owner": True}},
                )
                bot_token = r.json().get("token", "")

                # User token
                r = await client.post(
                    "https://api.daily.co/v1/meeting-tokens",
                    headers={"Authorization": f"Bearer {daily_api_key}"},
                    json={"properties": {"room_name": room_name, "is_owner": False}},
                )
                user_token = r.json().get("token", "")

        except Exception as e:
            logger.error(f"Error setting up Daily room: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

        transport = DailyTransport(
            room_url, bot_token, "AI Interviewer",
            params=DailyParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                video_out_enabled=True,
                video_out_width=1024,
                video_out_height=576,
            ),
        )
        background_tasks.add_task(run_bot, transport)
        logger.info("Bot starting in background")
        return JSONResponse({"room_url": room_url, "token": user_token})

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7860)
    args, _ = parser.parse_known_args()
    uvicorn.run(app, host=args.host, port=args.port)
