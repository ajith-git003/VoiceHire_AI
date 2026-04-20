# VoiceHire AI — Real-Time AI Interview Coach

An AI-powered voice interview platform that conducts professional job interviews, evaluates candidates, and delivers structured performance feedback — all in real-time through your browser.

---

## Overview

VoiceHire AI connects candidates to an AI interviewer that listens, speaks, and adapts. You configure the job description, experience level, and interviewer personality; the bot conducts the interview, then generates a scored feedback report.

**Key capabilities:**
- Live voice conversation via WebRTC (Daily.co)
- Animated robot avatar that reacts to speaking/listening states
- Customizable interviewer personality: `friendly`, `decent`, or `strict`
- Experience-level calibration: fresher → 10+ years
- Resume upload (PDF or TXT) for context-aware questions
- Job description input with 11 built-in role presets
- AI-generated feedback with scores, strengths, and improvement tips

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vite · Vanilla JS · `@pipecat-ai/client-js` · `@pipecat-ai/daily-transport` |
| **Backend** | Python 3.11 · FastAPI · Uvicorn |
| **Voice Pipeline** | [Pipecat AI](https://github.com/pipecat-ai/pipecat) |
| **Speech-to-Text** | Deepgram |
| **Text-to-Speech** | Cartesia |
| **LLM** | Groq |
| **WebRTC Transport** | Daily.co |
| **VAD** | Silero Voice Activity Detection |
| **Resume Parsing** | pypdf |

---

## Prerequisites

- Python 3.11+
- Node.js 18+
- API keys for: **Daily**, **Deepgram**, **Groq**, **Cartesia**

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/ajith-git003/VoiceHire_AI.git
cd VoiceHire_AI
```

### 2. Set up the backend

```bash
cd simple-chatbot/server
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in `simple-chatbot/server/`:

```env
DAILY_API_KEY=your_daily_api_key
DEEPGRAM_API_KEY=your_deepgram_api_key
GROQ_API_KEY=your_groq_api_key
CARTESIA_API_KEY=your_cartesia_api_key
```

### 3. Set up the frontend

```bash
cd ../client
npm install
```

---

## Running Locally

Open **three terminals**:

**Terminal 1 — Bot server** (port 7860)
```bash
cd simple-chatbot/server
source venv/bin/activate
python bot.py
```

**Terminal 2 — Config server** (port 7861)
```bash
cd simple-chatbot/server
source venv/bin/activate
python config_server.py
```

**Terminal 3 — Frontend dev server**
```bash
cd simple-chatbot/client
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Usage

1. **Configure the interview** — Select a role preset or paste a custom job description. Choose the candidate's experience level and the bot's personality.
2. **Upload a resume** (optional) — Drop a PDF or TXT file; the bot uses it to ask targeted questions.
3. **Start the interview** — Click **Start Interview**. Allow microphone access when prompted.
4. **Conduct the interview** — Speak naturally. The animated avatar shows when the bot is listening vs. speaking.
5. **Get feedback** — After ending the session, click **Get Feedback** to receive a scored report with strengths and improvement areas.

---

## Project Structure

```
VoiceHire_AI/
├── simple-chatbot/
│   ├── server/
│   │   ├── bot.py               # Pipecat pipeline, interview logic, Daily room creation
│   │   ├── config_server.py     # Config & feedback API (port 7861)
│   │   ├── interview_config.json
│   │   ├── assets/              # Robot animation frames (25 PNGs)
│   │   └── requirements.txt
│   └── client/
│       ├── src/
│       │   ├── app.js           # Interview UI, WebRTC connection, feedback display
│       │   ├── config.js        # Transport configuration
│       │   └── style.css
│       ├── index.html
│       └── package.json
└── .runtime.txt                 # Python 3.11
```

---

## API Endpoints

### Bot Server — `http://localhost:7860`

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/start` | Create Daily room; returns connection tokens |

### Config Server — `http://localhost:7861`

| Method | Path | Description |
|---|---|---|
| `GET` | `/config` | Fetch current interview configuration |
| `POST` | `/config` | Update interview settings |
| `POST` | `/upload-resume` | Upload resume (PDF/TXT) |
| `POST` | `/feedback` | Generate AI feedback from transcript |

---

## Deployment

The project supports deployment to **Pipecat Cloud** using the included `pcc-deploy.toml`. The bot is containerized and the frontend can be served statically from any CDN.

---

## License

MIT
