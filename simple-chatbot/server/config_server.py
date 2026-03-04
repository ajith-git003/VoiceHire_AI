import io
import json
import os
import re

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "interview_config.json")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ────────────────────────────────────────────────────────

class InterviewConfig(BaseModel):
    botNature: str = "decent"
    experienceLevel: str = "3_5"
    JD: str = ""
    clearResume: bool = False   # True when user starts without uploading a resume


class TranscriptMessage(BaseModel):
    role: str   # "bot" | "user"
    text: str


class FeedbackRequest(BaseModel):
    transcript: list[TranscriptMessage]


# ── Config file helpers ────────────────────────────────────────────────────

def _load() -> dict:
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {"botNature": "decent", "experienceLevel": "3_5", "JD": "", "resume": ""}


def _save(data: dict) -> bool:
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False


# ── Interview config endpoints ─────────────────────────────────────────────

@app.get("/config")
async def get_config():
    return _load()


@app.post("/config")
async def set_config(config: InterviewConfig):
    nature = config.botNature if config.botNature in ("friendly", "decent", "strict") else "decent"
    valid_levels = ("fresher", "0_2", "3_5", "5_10", "10_plus")
    exp_level = config.experienceLevel if config.experienceLevel in valid_levels else "3_5"
    current = _load()
    current.update({"botNature": nature, "experienceLevel": exp_level, "JD": config.JD})
    if config.clearResume:
        current["resume"] = ""   # wipe stale resume from previous session
    _save(current)
    return {"status": "ok"}


# ── Resume upload endpoint ─────────────────────────────────────────────────

@app.post("/upload-resume")
async def upload_resume(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()

    text = ""
    if filename.endswith(".pdf"):
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(content))
            for page in reader.pages:
                text += (page.extract_text() or "") + "\n"
        except Exception as e:
            return {"status": "error", "message": f"PDF parse error: {e}"}
    elif filename.endswith(".txt"):
        text = content.decode("utf-8", errors="ignore")
    else:
        return {"status": "error", "message": "Unsupported file type. Use PDF or TXT."}

    text = text.strip()
    if not text:
        return {"status": "error", "message": "No text could be extracted from the file."}

    current = _load()
    current["resume"] = text
    _save(current)
    return {"status": "ok", "chars": len(text), "preview": text[:120]}


# ── AI Feedback endpoint ───────────────────────────────────────────────────

@app.post("/feedback")
async def generate_feedback(request: FeedbackRequest):
    if not request.transcript:
        return {"status": "error", "message": "Transcript is empty."}

    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        return {"status": "error", "message": "GROQ_API_KEY not set."}

    try:
        from groq import Groq
        client = Groq(api_key=groq_key)
    except ImportError:
        return {"status": "error", "message": "groq package not installed."}

    # Build transcript text
    lines = []
    for msg in request.transcript:
        speaker = "Interviewer" if msg.role == "bot" else "Candidate"
        lines.append(f"{speaker}: {msg.text}")
    transcript_text = "\n".join(lines)

    # Load context
    config = _load()
    jd = config.get("JD", "")
    resume = config.get("resume", "")

    context_parts = []
    if jd:
        context_parts.append(f"Job Description:\n{jd[:800]}")
    if resume:
        context_parts.append(f"Candidate Resume:\n{resume[:800]}")
    context = "\n\n".join(context_parts)

    prompt = f"""{context}

Interview Transcript:
{transcript_text}

Analyze this interview and respond ONLY with valid JSON — no extra text before or after:
{{
  "overall_score": <integer 1-10>,
  "summary": "<2-3 sentence overall assessment of the candidate>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<area 1>", "<area 2>", "<area 3>"],
  "communication": "<Excellent | Good | Fair | Needs Work>",
  "technical": "<Excellent | Good | Fair | Needs Work>",
  "final_tip": "<one specific, actionable piece of advice>"
}}"""

    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert interview coach. Return structured JSON feedback only. No markdown, no explanation outside the JSON.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        response_text = completion.choices[0].message.content or ""

        # Extract JSON even if model adds extra prose
        match = re.search(r"\{.*\}", response_text, re.DOTALL)
        if match:
            feedback = json.loads(match.group())
        else:
            feedback = {"summary": response_text, "overall_score": 0}

        return {"status": "ok", "feedback": feedback}

    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── Server entrypoint (used by bot.py background thread) ──────────────────

async def run_config_server():
    config = uvicorn.Config(app, host="0.0.0.0", port=7861, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()
