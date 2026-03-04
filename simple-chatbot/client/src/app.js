import { PipecatClient, RTVIEvent } from '@pipecat-ai/client-js';
import { TRANSPORT_CONFIG, createTransport } from './config';

const CONFIG_SERVER = import.meta.env.VITE_CONFIG_SERVER_URL || 'http://localhost:7861';

// ── Experience requirement labels (keyed by experience level) ────────────────
// {EXP_REQ} in each preset is replaced with the appropriate label at fill time.
const EXP_REQUIREMENTS = {
  fresher: 'No prior work experience required',
  '0_2':   '0–2 years of experience',
  '3_5':   '3–5 years of experience',
  '5_10':  '5–10 years of experience',
  '10_plus': '10+ years of experience',
};

// ── Role preset job descriptions — use {EXP_REQ} as the experience placeholder ─
const ROLE_PRESETS = {
  software_engineer: `We are looking for a Software Engineer to join our growing engineering team. You will design, build, and maintain efficient, reusable, and reliable code. Responsibilities include collaborating with cross-functional teams, participating in code reviews, and solving complex technical problems. Requirements: {EXP_REQ} in software development, proficiency in Python, Java, or JavaScript, familiarity with REST APIs, databases, and version control (Git). Strong problem-solving skills and a passion for writing clean, maintainable code.`,

  frontend_developer: `We are seeking a Frontend Developer to create visually compelling, responsive web applications. You will translate designs into clean, efficient code using HTML, CSS, and JavaScript frameworks such as React or Vue. Responsibilities include optimizing performance, ensuring cross-browser compatibility, and collaborating closely with UX designers and backend engineers. Requirements: {EXP_REQ} in frontend development, proficiency in React or a similar framework, knowledge of CSS-in-JS, responsive design, accessibility standards, and web performance best practices.`,

  backend_developer: `We are hiring a Backend Developer to build scalable server-side applications and APIs. You will architect and implement backend services, manage databases, and ensure high availability and performance. Responsibilities include designing RESTful APIs, working with SQL and NoSQL databases, and implementing authentication and security best practices. Requirements: {EXP_REQ} in backend development, experience with Node.js, Python, or Java, familiarity with cloud platforms such as AWS or GCP, and strong understanding of microservices architecture.`,

  data_scientist: `We are looking for a Data Scientist to analyze complex datasets and build machine learning models that drive business decisions. Responsibilities include data preprocessing, feature engineering, model training and evaluation, and presenting insights to stakeholders. Requirements: {EXP_REQ} in data science or a related analytical field, proficiency in Python including pandas, scikit-learn, and TensorFlow or PyTorch, strong understanding of statistics and machine learning algorithms, proficiency in SQL, and ability to communicate technical findings to non-technical audiences.`,

  hr_manager: `We are seeking an experienced HR Manager to oversee all aspects of human resources practices and processes. Responsibilities include managing recruitment and onboarding, developing HR policies, handling employee relations, performance management, and ensuring legal compliance. Requirements: {EXP_REQ} in HR management, knowledge of employment laws and regulations, excellent interpersonal and communication skills, experience with HRIS systems, and proven ability to handle sensitive and confidential matters professionally.`,

  product_manager: `We are looking for a Product Manager to lead the development of our product from ideation to launch. You will define product vision, gather requirements from stakeholders, prioritize features, and work closely with engineering and design teams. Responsibilities include writing detailed product specifications, conducting user research, analyzing market trends, and measuring product success through KPIs. Requirements: {EXP_REQ} in product management, strong analytical mindset, excellent communication skills, and experience with agile development methodologies.`,

  performance_marketing: `We are hiring a Performance Marketing Manager to drive measurable growth through paid digital channels. You will plan and execute campaigns across Google Ads, Meta, LinkedIn, and programmatic platforms, focusing on CPA, ROAS, and LTV optimization. Responsibilities include A/B testing ad creatives and landing pages, managing budgets, analyzing funnel data, and collaborating with content and product teams. Requirements: {EXP_REQ} in performance marketing, proficiency in Google Ads and Meta Business Manager, strong analytical skills, and experience with attribution tools and marketing analytics.`,

  devops_engineer: `We are looking for a DevOps Engineer to build and maintain scalable, reliable infrastructure and CI/CD pipelines. You will automate deployment processes, monitor system health, and ensure high availability across cloud environments. Responsibilities include managing Kubernetes clusters, writing infrastructure-as-code using Terraform or Ansible, implementing observability with tools like Prometheus and Grafana, and collaborating with development teams to improve release cycles. Requirements: {EXP_REQ} in DevOps or SRE, proficiency in AWS or GCP, strong scripting skills in Bash or Python, and experience with Docker and Kubernetes.`,

  fullstack_developer: `We are seeking a Full Stack Developer to build end-to-end web applications across frontend and backend stacks. You will own features from database schema to UI, working with React or Vue on the frontend and Node.js or Python on the backend. Responsibilities include designing RESTful APIs, managing databases, implementing authentication, and optimizing application performance. Requirements: {EXP_REQ} in full stack development, proficiency in JavaScript/TypeScript, React, and at least one backend framework, familiarity with SQL and NoSQL databases, and experience with cloud deployment.`,

  ml_engineer: `We are looking for a Machine Learning Engineer to productionize ML models and build scalable data pipelines. You will collaborate with data scientists to deploy models, build feature stores, and maintain ML infrastructure. Responsibilities include model training pipelines, inference optimization, A/B testing frameworks, and monitoring model performance in production. Requirements: {EXP_REQ} in ML engineering or a related field, proficiency in Python, experience with MLflow or similar experiment tracking, knowledge of distributed computing frameworks like Spark or Ray, and familiarity with cloud ML platforms such as AWS SageMaker or GCP Vertex AI.`,

  ui_ux_designer: `We are hiring a UI/UX Designer to craft intuitive, user-centered digital experiences. You will conduct user research, create wireframes and prototypes, and collaborate closely with product and engineering teams to ship polished interfaces. Responsibilities include defining user flows, running usability testing sessions, maintaining a design system, and iterating on designs based on data and feedback. Requirements: {EXP_REQ} in product or UX design, proficiency in Figma, strong portfolio demonstrating end-to-end design process, understanding of accessibility standards, and ability to communicate design rationale to stakeholders.`,

  business_analyst: `We are seeking a Business Analyst to bridge the gap between business stakeholders and technical teams. You will gather and document requirements, analyze processes, and translate business needs into actionable specifications. Responsibilities include conducting stakeholder interviews, producing detailed BRDs and user stories, performing data analysis to support decision-making, and facilitating sprint planning with development teams. Requirements: {EXP_REQ} in business analysis or a related field, strong proficiency in SQL and Excel, experience with tools like JIRA and Confluence, excellent written and verbal communication skills, and familiarity with agile delivery methodologies.`,
};

class InterviewCoach {
  constructor() {
    this.client           = null;
    this.isConnected      = false;
    this.endingInterview  = false;  // true when user clicked "End & Get Feedback"
    this.resumeUploaded   = false;  // true only if resume was uploaded this session
    this.selfCamStream    = null;

    // Bot streaming state
    this.currentBotBubble = null;
    this.currentBotText   = '';
    this._botSpeaking     = false;  // true only after BotStartedSpeaking

    // User turn accumulation — avoids one bubble per STT chunk
    this._pendingUserText   = '';
    this._currentUserBubble = null;

    // Full conversation transcript (for feedback)
    this.transcript = [];   // [{role:'bot'|'user', text:string}]

    this.bindDOM();
    this.bindControls();
  }

  // ── DOM refs ──────────────────────────────────────────────────────────────
  bindDOM() {
    this.headerControls  = document.getElementById('header-controls');
    this.micBtn          = document.getElementById('mic-btn');
    this.micLabel        = document.getElementById('mic-label');
    this.disconnectBtn   = document.getElementById('disconnect-btn');

    this.orbWrap         = document.getElementById('orb-wrap');
    this.orbCore         = document.getElementById('orb-core');
    this.orbStatusDot    = document.getElementById('orb-status-dot');
    this.orbStatusText   = document.getElementById('orb-status-text');

    this.prePanel        = document.getElementById('pre-panel');
    this.chatPanel       = document.getElementById('chat-panel');
    this.connectBtn      = document.getElementById('connect-btn');
    this.jdTextarea      = document.getElementById('jd-textarea');
    this.botNatureSelect       = document.getElementById('bot-nature-select');
    this.experienceLevelSelect = document.getElementById('experience-level-select');
    this.rolePresetSelect      = document.getElementById('role-preset-select');
    this.jdHint          = document.getElementById('jd-hint');
    this.jdReq           = document.getElementById('jd-req');
    this.presetBadge     = document.getElementById('preset-badge');
    this.configSection   = document.querySelector('.config-section');

    this.conversationLog = document.getElementById('conversation-log');
    this.thinkingRow     = document.getElementById('thinking-row');

    this.selfCamCard     = document.getElementById('self-cam-card');
    this.selfCamVideo    = document.getElementById('self-cam-video');
    this.listeningBar    = document.getElementById('listening-bar');

    // Resume upload
    this.resumeFileInput = document.getElementById('resume-file-input');
    this.resumeDropzone  = document.getElementById('resume-dropzone');
    this.resumeStatus    = document.getElementById('resume-status');

    // Feedback overlay
    this.feedbackOverlay = document.getElementById('feedback-overlay');
    this.feedbackLoading = document.getElementById('feedback-loading');
    this.feedbackBody    = document.getElementById('feedback-body');
    this.feedbackClose   = document.getElementById('feedback-close');

    // Static bot audio element (exists in HTML from page load — avoids autoplay block)
    this.botAudio = document.getElementById('bot-audio');
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  bindControls() {
    this.connectBtn.addEventListener('click', () => this.connect());
    this.disconnectBtn.addEventListener('click', () => this.endInterview());

    this.micBtn.addEventListener('click', () => {
      if (!this.client) return;
      const next = !this.client.isMicEnabled;
      this.client.enableMic(next);
      this.updateMicUI(next);
    });

    // Role preset — auto-fill JD when a preset is chosen
    this.rolePresetSelect.addEventListener('change', () => this.applyRolePreset());

    // Re-apply preset JD when experience level changes (so years stay in sync)
    this.experienceLevelSelect.addEventListener('change', () => {
      if (this.rolePresetSelect.value) this.applyRolePreset();
    });

    // Resume upload
    this.resumeDropzone.addEventListener('click', () => this.resumeFileInput.click());
    this.resumeFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) this.uploadResume(e.target.files[0]);
    });
    this.resumeDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.resumeDropzone.classList.add('dragover');
    });
    this.resumeDropzone.addEventListener('dragleave', () => {
      this.resumeDropzone.classList.remove('dragover');
    });
    this.resumeDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.resumeDropzone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) this.uploadResume(e.dataTransfer.files[0]);
    });

    // Feedback close
    this.feedbackClose.addEventListener('click', () => this.closeFeedback());
    this.feedbackOverlay.addEventListener('click', (e) => {
      if (e.target === this.feedbackOverlay) this.closeFeedback();
    });
  }

  // ── Resume upload ─────────────────────────────────────────────────────────
  async uploadResume(file) {
    const allowed = ['.pdf', '.txt'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext)) {
      this.setResumeStatus('error', '✗ Only PDF or TXT files are supported');
      return;
    }

    this.setResumeStatus('loading', 'Uploading…');

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch(`${CONFIG_SERVER}/upload-resume`, { method: 'POST', body: form });
      const data = await res.json();

      if (data.status === 'ok') {
        this.resumeUploaded = true;   // mark uploaded for this session
        this.resumeDropzone.classList.add('uploaded');
        this.resumeDropzone.querySelector('.resume-drop-text').textContent = `✓ ${file.name}`;
        this.resumeDropzone.querySelector('.resume-drop-hint').textContent = `${data.chars} characters extracted`;
        this.resumeDropzone.querySelector('.resume-icon').innerHTML =
          `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
        this.setResumeStatus('success', '✓ Resume uploaded — AI will ask about your experience');
      } else {
        this.setResumeStatus('error', `✗ ${data.message}`);
      }
    } catch {
      this.setResumeStatus('error', '✗ Upload failed — check server connection');
    }
  }

  setResumeStatus(type, msg) {
    this.resumeStatus.className = `resume-status ${type}`;
    this.resumeStatus.textContent = msg;
  }

  // ── Role preset ───────────────────────────────────────────────────────────
  applyRolePreset() {
    const role = this.rolePresetSelect.value;
    if (role && ROLE_PRESETS[role]) {
      const expReq = EXP_REQUIREMENTS[this.experienceLevelSelect.value] || EXP_REQUIREMENTS['3_5'];
      this.jdTextarea.value = ROLE_PRESETS[role].replace('{EXP_REQ}', expReq);
      this.jdTextarea.disabled = false;
      this._presetFilled = true;
      this.jdHint.textContent = 'Auto-filled — feel free to edit or leave as-is';
      this.jdHint.classList.remove('error');
      this.jdReq.style.display = 'none';
      this.presetBadge.style.display = '';
    } else {
      // Custom — clear only if the textarea was auto-filled by a preset
      if (this._presetFilled) this.jdTextarea.value = '';
      this._presetFilled = false;
      this.jdHint.textContent = 'Minimum 50 characters required';
      this.jdHint.classList.remove('error');
      this.jdReq.style.display = '';
      this.presetBadge.style.display = 'none';
      this.jdTextarea.focus();
    }
  }

  // ── Validation ────────────────────────────────────────────────────────────
  validateConfig() {
    const jd = this.jdTextarea.value.trim();
    if (!jd || jd.length < 50) {
      this.jdHint.textContent = '⚠ Please enter at least 50 characters';
      this.jdHint.classList.add('error');
      this.jdTextarea.focus();
      setTimeout(() => {
        this.jdHint.textContent = 'Minimum 50 characters required';
        this.jdHint.classList.remove('error');
      }, 3500);
      return false;
    }
    return true;
  }

  // ── Save config ───────────────────────────────────────────────────────────
  async saveConfig() {
    try {
      await fetch(`${CONFIG_SERVER}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botNature: this.botNatureSelect.value,
          experienceLevel: this.experienceLevelSelect.value,
          JD: this.jdTextarea.value.trim(),
          clearResume: !this.resumeUploaded,  // wipe stale resume if none uploaded this session
        }),
      });
    } catch (e) {
      console.warn('Config save failed (using defaults):', e);
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────
  async connect() {
    if (!this.validateConfig()) return;

    this.connectBtn.disabled = true;
    this.connectBtn.textContent = 'Starting…';
    this.transcript = [];   // reset transcript for new session

    // Unlock browser audio WHILE we still have the user-gesture context.
    // Without this, the audio element created later (when the WebRTC track
    // arrives, seconds after the click) gets blocked by autoplay policy.
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      await audioCtx.resume();
    } catch (_) { /* not all browsers expose AudioContext — safe to ignore */ }

    await this.saveConfig();

    try {
      const transport = await createTransport('smallwebrtc');

      this.client = new PipecatClient({
        transport,
        enableMic: true,
        enableCam: false,
        callbacks: {
          onConnected:    () => this.onConnected(),
          onDisconnected: () => this.onDisconnected(),
          onBotReady:     () => this.setOrbStatus('online', 'Interview started'),
          onUserTranscript: (data) => {
            if (data.final) this._appendUserText(data.text);
          },
          onError: (err) => console.error('RTVI error:', err),
        },
      });

      this.setupRTVIEvents();
      this.setupAudioVideo();
      await this.client.connect(TRANSPORT_CONFIG['smallwebrtc']);
    } catch (err) {
      console.error('Connect failed:', err);
      this.connectBtn.disabled = false;
      this.connectBtn.textContent = 'Sounds good, start interview';
    }
  }

  // ── End interview → feedback ──────────────────────────────────────────────
  async endInterview() {
    this.endingInterview = true;
    this.disconnectBtn.disabled = true;
    this.disconnectBtn.textContent = 'Ending…';
    if (this.client) await this.client.disconnect();
    // onDisconnected() will fire next and handle the feedback flow
  }

  // ── Self-cam ──────────────────────────────────────────────────────────────
  async startSelfCam() {
    try {
      this.selfCamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.selfCamVideo.srcObject = this.selfCamStream;
      this.selfCamCard.classList.add('visible');
    } catch { /* camera unavailable — silently skip */ }
  }

  stopSelfCam() {
    if (this.selfCamStream) {
      this.selfCamStream.getTracks().forEach(t => t.stop());
      this.selfCamStream = null;
    }
    this.selfCamVideo.srcObject = null;
    this.selfCamCard.classList.remove('visible');
  }

  // ── RTVI events ───────────────────────────────────────────────────────────
  setupRTVIEvents() {
    // Buffer LLM text — do NOT show it until BotStartedSpeaking fires.
    // This prevents text from appearing before the audio plays.
    this.client.on(RTVIEvent.BotLlmText, ({ text }) => {
      this.showThinking(false);
      this.currentBotText += text;

      if (this._botSpeaking) {
        // Speaking has already started — create bubble on first chunk, then update
        if (!this.currentBotBubble) {
          this.currentBotBubble = this.createBotBubble();
        }
        this.currentBotBubble.textContent = this.currentBotText;
        this.scrollToBottom();
      }
      // else: still buffering — bubble will be created in BotStartedSpeaking
    });

    this.client.on(RTVIEvent.BotStartedSpeaking, () => {
      this._botSpeaking = true;
      this.orbWrap.classList.add('speaking');
      this.setOrbStatus('speaking', 'Speaking…');
      this.startAudioVisualizer();

      // Show any text that buffered before audio started
      if (this.currentBotText.trim() && !this.currentBotBubble) {
        this.currentBotBubble = this.createBotBubble();
        this.currentBotBubble.textContent = this.currentBotText;
        this.scrollToBottom();
      }
    });

    this.client.on(RTVIEvent.BotStoppedSpeaking, () => {
      this._botSpeaking = false;
      this.orbWrap.classList.remove('speaking');
      this.setOrbStatus('online', 'Listening…');
      this.stopAudioVisualizer();
      if (this.currentBotBubble) {
        this.currentBotBubble.classList.remove('streaming');
        if (this.currentBotText.trim()) {
          this.transcript.push({ role: 'bot', text: this.currentBotText.trim() });
        }
        this.currentBotBubble = null;
      }
      this.currentBotText = '';
    });

    this.client.on(RTVIEvent.UserStartedSpeaking, () => {
      // Reset accumulator for this new turn
      this._pendingUserText   = '';
      this._currentUserBubble = null;
      this.listeningBar.classList.add('visible');
      this.setOrbStatus('listening', 'Listening…');
    });

    this.client.on(RTVIEvent.UserStoppedSpeaking, () => {
      this.listeningBar.classList.remove('visible');
      // Commit the full accumulated user turn to the transcript
      if (this._pendingUserText.trim()) {
        this.transcript.push({ role: 'user', text: this._pendingUserText.trim() });
      }
      this.showThinking(true);
      this.setOrbStatus('thinking', 'Thinking…');
    });
  }

  // Append a final STT chunk to the single live user bubble for this turn
  _appendUserText(text) {
    if (!text?.trim()) return;
    this._pendingUserText = (this._pendingUserText + ' ' + text).trim();

    if (!this._currentUserBubble) {
      // Build the bubble wrapper once
      const wrapper = document.createElement('div');
      wrapper.className = 'message-user';

      const label = document.createElement('div');
      label.className = 'msg-label';
      label.textContent = 'You';

      this._currentUserBubble = document.createElement('div');
      this._currentUserBubble.className = 'msg-bubble';

      wrapper.appendChild(label);
      wrapper.appendChild(this._currentUserBubble);
      this.conversationLog.appendChild(wrapper);
    }

    // Always overwrite with the full accumulated text
    this._currentUserBubble.textContent = this._pendingUserText;
    this.scrollToBottom();
  }

  // ── Audio / video ─────────────────────────────────────────────────────────
  setupAudioVideo() {
    this.client.on(RTVIEvent.TrackStarted, (track, participant) => {
      if (participant?.local) return;
      if (track.kind === 'audio') {
        // Save track so the visualizer can use it when bot starts speaking
        this._botAudioTrack = track;
        this.botAudio.srcObject = new MediaStream([track]);
        this.botAudio.muted = false;
        this.botAudio.volume = 1.0;
        this.botAudio.play().catch(e => console.warn('[Audio] play() failed:', e));
      }
      // Ignore the bot's video (robot sprite) — we use our own waveform visualizer
    });

    this.client.on(RTVIEvent.TrackStopped, () => {});
  }

  // ── Audio visualizer — shown only while bot is speaking ───────────────────
  startAudioVisualizer() {
    if (!this._botAudioTrack) return;
    this.stopAudioVisualizer();

    this._vizCtx = new (window.AudioContext || window.webkitAudioContext)();
    this._vizCtx.resume().catch(() => {});
    this._analyser = this._vizCtx.createAnalyser();
    this._analyser.fftSize = 128;
    this._analyser.smoothingTimeConstant = 0.82;

    const source = this._vizCtx.createMediaStreamSource(new MediaStream([this._botAudioTrack]));
    source.connect(this._analyser);

    // Build canvas inside the orb-core
    this.orbCore.innerHTML = '';
    const SIZE = 126;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE; canvas.height = SIZE;
    canvas.style.cssText = 'width:126px;height:126px;border-radius:50%;display:block;';
    this.orbCore.appendChild(canvas);

    const ctx    = canvas.getContext('2d');
    const anl    = this._analyser;
    const bufLen = anl.frequencyBinCount;   // 64
    const data   = new Uint8Array(bufLen);
    const cx = SIZE / 2, cy = SIZE / 2;

    const draw = () => {
      this._vizRAF = requestAnimationFrame(draw);
      anl.getByteFrequencyData(data);

      // Dark circular background
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.beginPath(); ctx.arc(cx, cy, cx, 0, Math.PI * 2);
      ctx.fillStyle = '#0e0b1f'; ctx.fill();

      // Dot ring that pulses with audio
      const DOTS = 40, DOT_R = 1.8, RING_R = 56;
      for (let i = 0; i < DOTS; i++) {
        const angle = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
        const v = data[Math.floor((i / DOTS) * bufLen)] / 255;
        const x = cx + RING_R * Math.cos(angle);
        const y = cy + RING_R * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(x, y, DOT_R + v * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${106 + v*80},${85 + v*120},224,${0.28 + v*0.72})`;
        ctx.fill();
      }

      // Frequency bars (purple → teal)
      const BARS = 26, BAR_W = 3, GAP = 2, MAX_H = 26;
      const startX = cx - (BARS * (BAR_W + GAP) - GAP) / 2;
      for (let i = 0; i < BARS; i++) {
        const v = data[Math.floor((i / BARS) * bufLen * 0.75)] / 255;
        const barH = Math.max(2.5, v * MAX_H);
        const t = i / (BARS - 1);
        ctx.fillStyle = `rgba(${Math.round(106*(1-t)+34*t)},${Math.round(85*(1-t)+211*t)},${Math.round(224*(1-t)+238*t)},0.92)`;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(startX + i*(BAR_W+GAP), cy - barH, BAR_W, barH*2, 1.5);
        else ctx.rect(startX + i*(BAR_W+GAP), cy - barH, BAR_W, barH*2);
        ctx.fill();
      }
    };
    draw();
  }

  stopAudioVisualizer() {
    if (this._vizRAF) { cancelAnimationFrame(this._vizRAF); this._vizRAF = null; }
    if (this._vizCtx) { this._vizCtx.close().catch(() => {}); this._vizCtx = null; }
    this._analyser = null;
  }

  resetOrbToAvatar() {
    this.stopAudioVisualizer();
    this.orbCore.innerHTML = `
      <div class="orb-default-avatar">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#6a55e0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      </div>`;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────
  onConnected() {
    this.isConnected = true;
    this.prePanel.style.display = 'none';
    this.chatPanel.classList.add('visible');
    this.headerControls.classList.add('visible');
    this.micBtn.disabled = false;
    this.updateMicUI(true);
    this.disconnectBtn.disabled = false;
    this.disconnectBtn.textContent = 'End & Get Feedback';
    this.setOrbStatus('online', 'Connected');
  }

  async onDisconnected() {
    this.isConnected = false;
    this._botAudioTrack   = null;
    this._botSpeaking     = false;
    this.currentBotText   = '';
    this.currentBotBubble = null;
    this._pendingUserText   = '';
    this._currentUserBubble = null;
    this.orbWrap.classList.remove('speaking');
    this.showThinking(false);
    this.listeningBar.classList.remove('visible');
    this.headerControls.classList.remove('visible');
    this.micBtn.disabled = true;
    this.setOrbStatus('', 'Ready to start');
    this.resetOrbToAvatar();

    if (this.endingInterview) {
      this.endingInterview = false;
      // Show feedback overlay and fetch analysis
      this.showFeedbackOverlay();
      await this.fetchAndRenderFeedback();
    } else {
      // Normal unexpected disconnect — go back to pre-panel
      this.goToPrePanel();
    }
  }

  goToPrePanel() {
    this.chatPanel.classList.remove('visible');
    this.prePanel.style.display = '';
    this.connectBtn.disabled = false;
    this.connectBtn.textContent = 'Sounds good, start interview';
    this.currentBotBubble = null;
    this.currentBotText = '';

    // Reset resume state so next interview starts fresh
    this.resumeUploaded = false;
    this.resumeDropzone.classList.remove('uploaded');
    this.resumeDropzone.querySelector('.resume-drop-text').textContent = 'Drop your resume here or click to browse';
    this.resumeDropzone.querySelector('.resume-drop-hint').textContent = 'PDF or TXT · max 5 MB';
    this.resumeDropzone.querySelector('.resume-icon').innerHTML =
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="12" y1="18" x2="12" y2="12"/>
        <line x1="9" y1="15" x2="15" y2="15"/>
       </svg>`;
    this.resumeStatus.className = 'resume-status';
    this.resumeStatus.textContent = '';
  }

  async disconnect() {
    if (this.client) await this.client.disconnect();
  }

  // ── Feedback ──────────────────────────────────────────────────────────────
  showFeedbackOverlay() {
    this.feedbackOverlay.classList.add('visible');
    this.feedbackLoading.style.display = 'flex';
    this.feedbackBody.style.display = 'none';
  }

  closeFeedback() {
    this.feedbackOverlay.classList.remove('visible');
    this.goToPrePanel();
  }

  async fetchAndRenderFeedback() {
    try {
      const res = await fetch(`${CONFIG_SERVER}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: this.transcript }),
      });
      const data = await res.json();

      if (data.status === 'ok') {
        this.renderFeedback(data.feedback);
      } else {
        this.renderFeedbackError(data.message || 'Unknown error');
      }
    } catch (err) {
      this.renderFeedbackError('Could not connect to server.');
    }
  }

  renderFeedback(f) {
    this.feedbackLoading.style.display = 'none';

    const score = Math.max(1, Math.min(10, f.overall_score || 0));
    const pct   = score / 10;
    const circum = 2 * Math.PI * 32;  // r=32
    const dash   = pct * circum;

    const strengths = (f.strengths || []).map(s =>
      `<div class="feedback-list-item strength">
         <div class="item-dot"></div><span>${s}</span>
       </div>`).join('');

    const improvements = (f.improvements || []).map(s =>
      `<div class="feedback-list-item improve">
         <div class="item-dot"></div><span>${s}</span>
       </div>`).join('');

    this.feedbackBody.innerHTML = `
      <!-- Score hero -->
      <div class="score-hero">
        <div class="score-ring">
          <svg width="76" height="76" viewBox="0 0 76 76">
            <circle class="score-ring-bg"   cx="38" cy="38" r="32" fill="none" stroke-width="5"/>
            <circle class="score-ring-fill" cx="38" cy="38" r="32" fill="none" stroke-width="5"
              stroke-dasharray="${circum}"
              stroke-dashoffset="${circum - dash}"/>
          </svg>
          <div class="score-ring-text">
            <span class="score-number">${score}</span>
            <span class="score-denom">/10</span>
          </div>
        </div>
        <p class="score-summary">${f.summary || 'No summary available.'}</p>
      </div>

      <!-- Ratings -->
      <div class="rating-row">
        <div class="rating-chip">
          <div class="rating-chip-label">Communication</div>
          <div class="rating-chip-value">${f.communication || '—'}</div>
        </div>
        <div class="rating-chip">
          <div class="rating-chip-label">Technical</div>
          <div class="rating-chip-value">${f.technical || '—'}</div>
        </div>
      </div>

      <!-- Strengths -->
      ${strengths ? `
      <div class="feedback-section">
        <div class="section-title"><span>✅</span> Strengths</div>
        <div class="feedback-list">${strengths}</div>
      </div>` : ''}

      <!-- Areas to improve -->
      ${improvements ? `
      <div class="feedback-section">
        <div class="section-title"><span>💡</span> Areas for Improvement</div>
        <div class="feedback-list">${improvements}</div>
      </div>` : ''}

      <!-- Final tip -->
      ${f.final_tip ? `
      <div class="feedback-section">
        <div class="section-title"><span>🎯</span> Pro Tip</div>
        <div class="final-tip">
          <div class="final-tip-label">Action Item</div>
          ${f.final_tip}
        </div>
      </div>` : ''}

      <button class="btn-new-interview" id="btn-new-interview">Start a New Interview</button>
    `;

    this.feedbackBody.style.display = 'flex';

    document.getElementById('btn-new-interview').addEventListener('click', () => this.closeFeedback());
  }

  renderFeedbackError(msg) {
    this.feedbackLoading.style.display = 'none';
    this.feedbackBody.innerHTML = `
      <div style="text-align:center; padding: 32px 16px; color: #5a5478;">
        <div style="font-size:32px; margin-bottom:12px;">⚠️</div>
        <p style="font-size:14px;">Could not generate feedback.</p>
        <p style="font-size:12px; margin-top:6px; color:#9490b0;">${msg}</p>
        <button class="btn-new-interview" id="btn-new-interview" style="margin-top:20px;">Back to Setup</button>
      </div>`;
    this.feedbackBody.style.display = 'flex';
    document.getElementById('btn-new-interview').addEventListener('click', () => this.closeFeedback());
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  updateMicUI(enabled) {
    this.micLabel.textContent = enabled ? 'Mic On' : 'Mic Off';
    this.micBtn.classList.toggle('active', enabled);
  }

  setOrbStatus(dotClass, text) {
    this.orbStatusDot.className = 'orb-status-dot';
    if (dotClass) this.orbStatusDot.classList.add(dotClass);
    this.orbStatusText.textContent = text;
  }

  showThinking(show) {
    this.thinkingRow.classList.toggle('visible', show);
    if (show) this.scrollToBottom();
  }

  scrollToBottom() {
    this.conversationLog.scrollTo({ top: this.conversationLog.scrollHeight, behavior: 'smooth' });
  }

  // ── Message creation ──────────────────────────────────────────────────────
  createBotBubble() {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-bot';

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = 'AI Interviewer';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble streaming';

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    this.conversationLog.appendChild(wrapper);
    this.scrollToBottom();
    return bubble;
  }

  addUserMessage(text) {
    if (!text?.trim()) return;

    // Save to transcript
    this.transcript.push({ role: 'user', text: text.trim() });

    const wrapper = document.createElement('div');
    wrapper.className = 'message-user';

    const label = document.createElement('div');
    label.className = 'msg-label';
    label.textContent = 'You';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    wrapper.appendChild(label);
    wrapper.appendChild(bubble);
    this.conversationLog.appendChild(wrapper);
    this.scrollToBottom();
  }
}

window.addEventListener('DOMContentLoaded', () => new InterviewCoach());
