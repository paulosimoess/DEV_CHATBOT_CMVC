const TEXTO_RGPD =
  "Antes de iniciar a conversa, gostaria de informar que, de acordo com o Regulamento Geral de Proteção de Dados (RGPD), esta conversa está registada. Se não concordar com este registo, por favor utilize outro canal.";

function getEmbedChatbotId() {
  try {
    if (
      typeof window !== "undefined" &&
      window.EMBED_CHATBOT_ID !== undefined &&
      window.EMBED_CHATBOT_ID !== null
    ) {
      const id = parseInt(window.EMBED_CHATBOT_ID, 10);
      if (!isNaN(id)) return id;
    }
  } catch (e) {}
  try {
    const params = new URLSearchParams(window.location.search || "");
    const raw = params.get("chatbot_id");
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  } catch (e) {
    return null;
  }
}

const EMBED_CHATBOT_ID = getEmbedChatbotId();
if (EMBED_CHATBOT_ID) {
  try {
    localStorage.setItem("chatbotAtivo", String(EMBED_CHATBOT_ID));
  } catch (e) {}
}

function shadeColor(color, percent) {
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);
  R = Math.round((R * (100 + percent)) / 100);
  G = Math.round((G * (100 + percent)) / 100);
  B = Math.round((B * (100 + percent)) / 100);
  R = R < 255 ? R : 255;
  G = G < 255 ? G : 255;
  B = B < 255 ? B : 255;
  let RR = (R.toString(16).length == 1 ? "0" : "") + R.toString(16);
  let GG = (G.toString(16).length == 1 ? "0" : "") + G.toString(16);
  let BB = (B.toString(16).length == 1 ? "0" : "") + B.toString(16);
  return "#" + RR + GG + BB;
}

function atualizarIconesChatbot(iconBot) {
  const elementos = document.querySelectorAll("[data-chatbot-icon]");
  elementos.forEach((el) => {
    if (el.tagName === "LINK") {
      el.href = iconBot;
    } else if (el.tagName === "IMG") {
      el.src = iconBot;
    }
  });
}

function atualizarCorChatbot() {
  const corBot = localStorage.getItem("corChatbot") || "#d4af37";
  const btnToggle = document.getElementById("chatToggleBtn");
  if (btnToggle) {
    btnToggle.style.backgroundColor = corBot;
  }
  const btnEnviar = document.getElementById("chatSendBtn");
  const micBtn = document.getElementById("chatMicBtn");
  if (btnEnviar) {
    btnEnviar.style.backgroundColor = corBot;
    btnEnviar.onmouseenter = () =>
      (btnEnviar.style.backgroundColor = shadeColor(corBot, 12));
    btnEnviar.onmouseleave = () => (btnEnviar.style.backgroundColor = corBot);
  }
  if (micBtn) {
    micBtn.style.borderColor = corBot;
    micBtn.style.color = corBot;
  }
}

async function refreshChatbotVideoUrls(chatbotId) {
  if (!chatbotId || isNaN(chatbotId)) return null;
  try {
    const res = await fetch(`/chatbots/${chatbotId}`);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || !data.success) return null;

    if (data.video_greeting_path) {
      localStorage.setItem("videoGreetingPath", data.video_greeting_path);
    } else {
      localStorage.removeItem("videoGreetingPath");
    }
    if (data.video_idle_path) {
      localStorage.setItem("videoIdlePath", data.video_idle_path);
    } else {
      localStorage.removeItem("videoIdlePath");
    }
    if (data.video_positive_path) {
      localStorage.setItem("videoPositivePath", data.video_positive_path);
    } else {
      localStorage.removeItem("videoPositivePath");
    }
    if (data.video_negative_path) {
      localStorage.setItem("videoNegativePath", data.video_negative_path);
    } else {
      localStorage.removeItem("videoNegativePath");
    }
    if (data.video_no_answer_path) {
      localStorage.setItem("videoNoAnswerPath", data.video_no_answer_path);
    } else {
      localStorage.removeItem("videoNoAnswerPath");
    }
    return data;
  } catch (e) {
    return null;
  }
}

function disableMicIfInsecure() {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const isSecure = window.location.protocol === "https:" || isLocalhost;
  if (isSecure) return;
  const micBtn = document.getElementById("chatMicBtn");
  if (!micBtn) return;
  micBtn.disabled = true;
  micBtn.title = "Microfone requer HTTPS";
  micBtn.style.opacity = "0.55";
  micBtn.style.cursor = "not-allowed";
}

document.addEventListener("DOMContentLoaded", function () {
  atualizarCorChatbot();
  atualizarIconesChatbot(
    localStorage.getItem("iconBot") ||
      "/static/images/chatbot/chatbot-icon.png",
  );
  disableMicIfInsecure();
  try {
    updateAvatarSoundButton();
  } catch (e) {}
});

function getIdiomaAtual() {
  return localStorage.getItem("idiomaAtivo") || "pt";
}

function formatarDataMensagem(date) {
  const meses = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  const dia = String(date.getDate()).padStart(2, "0");
  const mes = meses[date.getMonth()];
  const ano = date.getFullYear();
  const horas = String(date.getHours()).padStart(2, "0");
  const minutos = String(date.getMinutes()).padStart(2, "0");
  return `${dia} de ${mes} de ${ano} ${horas}:${minutos}`;
}

function gerarDataHoraFormatada() {
  const agora = new Date();
  return (
    agora.toLocaleDateString("pt-PT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }) +
    " " +
    agora.toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
    })
  );
}
// ----- Modo texto / avatar -----
let micAtivo = false;
let micStream = null;

// Simple silence-based auto-stop + PCM capture
let audioContext = null;
let analyserNode = null;
let sourceNode = null;
let processorNode = null;
let silencioTimeout = null;
let recordedBuffers = [];
let recordedSampleRate = 16000;
const SILENCIO_MS = 1500; // tempo sem som antes de parar (~1.5s)
const SILENCIO_LIMIAR = 0.01; // limiar de volume (0-1)

function limparSilencioMonitor() {
  if (silencioTimeout) {
    clearTimeout(silencioTimeout);
    silencioTimeout = null;
  }
}

function iniciarMonitorSilencio(stream) {
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    sourceNode.connect(analyserNode);

    recordedBuffers = [];
    recordedSampleRate = audioContext.sampleRate;

    // Capture PCM via ScriptProcessorNode (widely supported)
    const bufferSize = 4096;
    processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    const dataArray = new Uint8Array(analyserNode.fftSize);

    processorNode.onaudioprocess = (event) => {
      if (!micAtivo) return;

      const input = event.inputBuffer.getChannelData(0);
      recordedBuffers.push(new Float32Array(input));

      analyserNode.getByteTimeDomainData(dataArray);
      let soma = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const amostra = (dataArray[i] - 128) / 128; // -1 a 1
        soma += amostra * amostra;
      }
      const rms = Math.sqrt(soma / dataArray.length);

      if (rms < SILENCIO_LIMIAR) {
        if (!silencioTimeout) {
          silencioTimeout = setTimeout(() => {
            pararGravacao();
          }, SILENCIO_MS);
        }
      } else {
        limparSilencioMonitor();
      }
    };
  } catch (e) {
    console.warn("Falha ao iniciar monitor de silêncio:", e);
  }
}

function limparAudioContext() {
  limparSilencioMonitor();
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (e) {}
  }
  if (analyserNode) {
    try {
      analyserNode.disconnect();
    } catch (e) {}
  }
  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch (e) {}
  }
  if (audioContext) {
    audioContext.close();
  }
  sourceNode = null;
  analyserNode = null;
  processorNode = null;
  audioContext = null;
}

async function pararGravacao() {
  const micBtn = document.getElementById("chatMicBtn");

  if (!micAtivo) return;

  micAtivo = false;
  limparSilencioMonitor();
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  limparAudioContext();

  if (micBtn) {
    micBtn.classList.remove("active");
  }

  // Depois de parar a captura, enviar o WAV para transcrição
  enviarWavParaTranscricao();
}

async function toggleMic() {
  const micBtn = document.getElementById("chatMicBtn");

  // Se já está ativo, parar manualmente (fallback)
  if (micAtivo) {
    await pararGravacao();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("O seu navegador não suporta acesso ao microfone.");
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    iniciarMonitorSilencio(micStream);

    micAtivo = true;
    if (micBtn) {
      micBtn.classList.add("active");
    }
  } catch (err) {
    console.error("Erro ao obter acesso ao microfone:", err);
    alert(
      "Não foi possível aceder ao microfone. Verifique as permissões do navegador.",
    );
    micAtivo = false;
    if (micBtn) {
      micBtn.classList.remove("active");
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    limparAudioContext();
  }
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function encodeWAV(buffers, sampleRate) {
  // Concat all Float32 chunks
  let length = 0;
  for (const b of buffers) length += b.length;
  const merged = new Float32Array(length);
  let offset = 0;
  for (const b of buffers) {
    merged.set(b, offset);
    offset += b.length;
  }

  const pcmBuffer = floatTo16BitPCM(merged);
  const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
  const view = new DataView(wavBuffer);

  // RIFF chunk descriptor
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeString(view, 8, "WAVE");

  // FMT sub-chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1=PCM)
  view.setUint16(22, 1, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate*NumChannels*BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels*BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample

  // data sub-chunk
  writeString(view, 36, "data");
  view.setUint32(40, pcmBuffer.byteLength, true);

  // PCM data
  new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmBuffer));

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Enviar WAV gravado para o backend e acionar o envio da pergunta
async function enviarWavParaTranscricao() {
  if (!recordedBuffers.length) return;
  try {
    const blob = encodeWAV(recordedBuffers, recordedSampleRate);
    recordedBuffers = [];

    const formData = new FormData();
    formData.append("audio", blob, "audio.wav");

    const resp = await fetch("/vosk/transcribe", {
      method: "POST",
      body: formData,
    });
    const data = await resp.json();
    if (data && data.success && data.text) {
      const chatInput = document.getElementById("chatInput");
      if (chatInput) {
        chatInput.value = data.text;
      }
      enviarPergunta();
    }
  } catch (e) {
    console.error("Erro ao transcrever áudio:", e);
  }
}

let avatarAtivo = true;
let currentFaqVideoId = null;

const AVATAR_SOUND_MUTED_KEY = "avatarSoundMuted";
let pendingSoundUnlock = false;
let soundUnlockListenerAttached = false;

function isAvatarSoundMuted() {
  try {
    return localStorage.getItem(AVATAR_SOUND_MUTED_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function updateAvatarSoundButton() {
  const btn = document.getElementById("chatMuteBtn");
  if (!btn) return;
  const muted = isAvatarSoundMuted();
  btn.textContent = muted ? "🔇 Som" : "🔊 Som";
}

function tryUnmuteAndPlayCurrentVideo() {
  if (isAvatarSoundMuted()) return;
  const videoEl = document.querySelector(".chat-avatar-video");
  if (!videoEl) return;
  try {
    videoEl.muted = false;
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        videoEl.muted = true;
        pendingSoundUnlock = true;
        ensureSoundUnlockListener();
      });
    }
  } catch (e) {
    pendingSoundUnlock = true;
    ensureSoundUnlockListener();
  }
}

function ensureSoundUnlockListener() {
  if (soundUnlockListenerAttached) return;
  const handler = () => {
    soundUnlockListenerAttached = false;
    if (!pendingSoundUnlock) return;
    pendingSoundUnlock = false;
    tryUnmuteAndPlayCurrentVideo();
  };
  document.addEventListener("pointerdown", handler, { once: true, capture: true });
  document.addEventListener("keydown", handler, { once: true, capture: true });
  document.addEventListener("touchstart", handler, { once: true, capture: true });
  soundUnlockListenerAttached = true;
}

function setAvatarSoundMuted(muted) {
  try {
    localStorage.setItem(AVATAR_SOUND_MUTED_KEY, muted ? "1" : "0");
  } catch (e) {}
  updateAvatarSoundButton();

  // Apply immediately to current video
  try {
    const videoEl = document.querySelector(".chat-avatar-video");
    if (videoEl) {
      if (muted) {
        videoEl.muted = true;
      } else {
        tryUnmuteAndPlayCurrentVideo();
      }
    }
  } catch (e) {}
}

function toggleAvatarSound() {
  setAvatarSoundMuted(!isAvatarSoundMuted());
}

window.toggleAvatarSound = toggleAvatarSound;

function toggleAvatarAtivo() {
  avatarAtivo = !avatarAtivo;
  const avatarPanel = document.getElementById("chatAvatarPanel");
  const btn = document.getElementById("avatarToggleBtn");
  const videoEl = document.querySelector(".chat-avatar-video");

  if (avatarPanel) {
    avatarPanel.style.display = avatarAtivo ? "flex" : "none";
  }
  if (btn) {
    btn.textContent = avatarAtivo ? "⏻ Desligar avatar" : "⏻ Ligar avatar";
  }

  // Mute/unmute video based on avatar state
  if (videoEl) {
    if (!avatarAtivo) {
      // Avatar desligado: mutar vídeo e pausar
      videoEl.muted = true;
      videoEl.pause();
    } else {
      // Avatar ligado: restaurar estado normal do vídeo
      // Se for greeting, tentar unmute; se for idle, manter muted
      const idlePath = localStorage.getItem("videoIdlePath");
      const greetingPath = localStorage.getItem("videoGreetingPath");
      const isIdle = videoEl.src && videoEl.src.includes("idle");

      if (isIdle || (!greetingPath && idlePath)) {
        // É idle ou só temos idle: manter muted
        videoEl.muted = true;
      } else if (greetingPath && !hasPlayedGreeting) {
        // É greeting e ainda não foi reproduzido: tentar unmute
        videoEl.muted = isAvatarSoundMuted() ? true : false;
      }

      // Tentar reproduzir se o vídeo já estava carregado
      if (videoEl.src) {
        videoEl.play().catch(() => {
          // Se falhar, tentar muted
          if (!isAvatarSoundMuted()) {
            pendingSoundUnlock = true;
            ensureSoundUnlockListener();
          }
          videoEl.muted = true;
          videoEl.play().catch(() => {});
        });
      }
    }
  }
}

function mostrarSpinnerVideoFaq(faqId) {
  if (!avatarAtivo) return;
  const avatarPanel = document.getElementById("chatAvatarPanel");
  if (!avatarPanel || !faqId) return;

  const avatarInner = avatarPanel.querySelector(".chat-avatar-inner");
  if (!avatarInner) return;

  let videoEl = avatarInner.querySelector("video.chat-avatar-video");
  let imgEl = avatarInner.querySelector("img.chat-avatar-image");
  let spinnerEl = avatarInner.querySelector(".video-spinner");

  if (!spinnerEl) {
    spinnerEl = document.createElement("div");
    spinnerEl.className = "video-spinner";
    spinnerEl.innerHTML = '<div class="spinner-ring"></div>';
    avatarInner.appendChild(spinnerEl);
  }

  // Fallback to icon/image while the FAQ video is being generated (avoid blank avatar panel)
  if (imgEl) imgEl.style.display = "block";
  if (videoEl) videoEl.style.display = "none";
  spinnerEl.style.display = "flex";

  const restoreIdleOrImage = () => {
    const idlePath = localStorage.getItem("videoIdlePath");
    if (idlePath && videoEl) {
      try {
        videoEl.pause();
      } catch (e) {}
      videoEl.src = idlePath;
      videoEl.loop = true;
      videoEl.muted = true;
      videoEl.style.display = "block";
      if (imgEl) imgEl.style.display = "none";
      try {
        videoEl.playbackRate = 0.3;
      } catch (e) {}
      videoEl.play().catch(() => {
        videoEl.style.display = "none";
        if (imgEl) imgEl.style.display = "block";
      });
      return;
    }
    if (videoEl) videoEl.style.display = "none";
    if (imgEl) imgEl.style.display = "block";
  };

  // Polling para verificar se o vídeo está pronto
  const checkVideoReady = async () => {
    // Stop polling if avatar is disabled
    if (!avatarAtivo) {
      spinnerEl.style.display = "none";
      restoreIdleOrImage();
      return;
    }

    try {
      const res = await fetch(`/video/faq/status/${faqId}`);
      if (res.status === 404) {
        // FAQ apagada/cancelada: parar polling e voltar ao fallback
        spinnerEl.style.display = "none";
        restoreIdleOrImage();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data && data.success && data.video_status === "ready") {
          spinnerEl.style.display = "none";
          mostrarVideoFaqNoAvatar(faqId);
          return;
        }
        if (data && data.success) {
          // Only keep spinner while queued/processing. Any other state means: stop spinner.
          if (
            data.video_status === "queued" ||
            data.video_status === "processing"
          ) {
            setTimeout(checkVideoReady, 2000);
            return;
          }
          spinnerEl.style.display = "none";
          restoreIdleOrImage();
          return;
        }
      }
      setTimeout(checkVideoReady, 2000);
    } catch (e) {
      setTimeout(checkVideoReady, 2000);
    }
  };

  checkVideoReady();
}

async function mostrarVideoFaqNoAvatar(faqId) {
  if (!avatarAtivo) return;
  const avatarPanel = document.getElementById("chatAvatarPanel");
  if (!avatarPanel || !faqId) return;

  const avatarInner = avatarPanel.querySelector(".chat-avatar-inner");
  if (!avatarInner) return;

  const videoEl = avatarInner.querySelector("video.chat-avatar-video");
  const imgEl = avatarInner.querySelector("img.chat-avatar-image");
  const spinnerEl = avatarInner.querySelector(".video-spinner");

  if (!videoEl) return;

  if (spinnerEl) spinnerEl.style.display = "none";
  if (imgEl) imgEl.style.display = "none";

  try {
    videoEl.pause();
  } catch (e) {}

  // Prefer signed/controlled stream url (from status endpoint), fallback to direct route
  // Only make API calls if avatar is active
  if (!avatarAtivo) return;

  let streamUrl = null;
  try {
    const sres = await fetch(`/video/faq/status/${faqId}`);
    if (sres.ok) {
      const sdata = await sres.json();
      if (sdata && sdata.success && sdata.stream_url) {
        streamUrl = sdata.stream_url;
      }
    }
  } catch (e) {}
  videoEl.src = streamUrl || `/video/faq/${faqId}`;
  videoEl.style.display = "block";
  videoEl.loop = false;
  // Ensure FAQ video keeps normal speed even after idle/restart changes
  try {
    videoEl.defaultPlaybackRate = 1.0;
  } catch (e) {}
  try {
    const enforceRate = () => {
      try {
        videoEl.playbackRate = 1.0;
      } catch (e) {}
    };
    videoEl.addEventListener("loadeddata", enforceRate, { once: true });
  } catch (e) {}
  // Ensure FAQ video plays at normal speed
  try {
    videoEl.playbackRate = 1.0;
  } catch (e) {}
  // Try to play FAQ video with sound (unmuted)
  videoEl.muted = isAvatarSoundMuted() ? true : false;

  const onEnded = async () => {
    // Ao terminar, voltar ao idle (se existir) ou manter imagem
    // Clear FAQ video ID since we're done with it
    currentFaqVideoId = null;
    try {
      videoEl.removeEventListener("ended", onEnded);
    } catch (e) {}
    let idlePath = localStorage.getItem("videoIdlePath");
    if (!idlePath) {
      try {
        const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
        await refreshChatbotVideoUrls(chatbotId);
        idlePath = localStorage.getItem("videoIdlePath");
      } catch (e) {}
    }
    if (idlePath) {
      // Pause current video
      videoEl.pause();

      // Set up idle video
      videoEl.src = idlePath;
      videoEl.loop = true;
      videoEl.muted = true; // Idle should be muted
      videoEl.style.display = "block";
      if (imgEl) imgEl.style.display = "none";

      // Function to play idle video
      const playIdle = async () => {
        // Ensure video is visible and image is hidden before playing
        videoEl.style.display = "block";
        if (imgEl) imgEl.style.display = "none";
        // Slow-motion idle animation (requested)
        try {
          videoEl.playbackRate = 0.3;
        } catch (e) {}
        try {
          await videoEl.play();
          // Double-check that video is visible and image is hidden after successful play
          videoEl.style.display = "block";
          if (imgEl) imgEl.style.display = "none";
        } catch (e) {
          // If idle video fails to play (often due to expired signed URL), refresh and retry once.
          try {
            const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
            await refreshChatbotVideoUrls(chatbotId);
            const freshIdle = localStorage.getItem("videoIdlePath");
            if (freshIdle) {
              videoEl.src = freshIdle;
              videoEl.loop = true;
              videoEl.muted = true;
              try {
                videoEl.playbackRate = 0.3;
              } catch (e) {}
              await videoEl.play();
              videoEl.style.display = "block";
              if (imgEl) imgEl.style.display = "none";
              return;
            }
          } catch (e2) {}
          // If still failing, show static image
          videoEl.style.display = "none";
          if (imgEl) imgEl.style.display = "block";
        }
      };

      // Check if video src already matches idle path (accounting for query params)
      const currentSrcBase = videoEl.src.split("?")[0];
      const idlePathBase = idlePath.split("?")[0];
      const isSameVideo =
        currentSrcBase === idlePathBase || videoEl.src.includes(idlePathBase);

      // If video is already loaded and it's the same video, play immediately
      if (videoEl.readyState >= 2 && isSameVideo) {
        playIdle();
      } else {
        // Wait for video to load
        const onLoaded = () => {
          videoEl.removeEventListener("loadeddata", onLoaded);
          playIdle();
        };
        videoEl.addEventListener("loadeddata", onLoaded);
        videoEl.load();
      }
    } else {
      videoEl.style.display = "none";
      if (imgEl) imgEl.style.display = "block";
    }
  };
  videoEl.addEventListener("ended", onEnded);

  try {
    videoEl.load();
  } catch (e) {}

  // Try to play with sound first, fallback to muted if autoplay policy blocks it
  videoEl.play().catch(() => {
    // Browser blocked autoplay with sound, try muted
    if (!isAvatarSoundMuted()) {
      pendingSoundUnlock = true;
      ensureSoundUnlockListener();
    }
    videoEl.muted = true;
    videoEl.play().catch(() => {
      // If even muted fails, show static image
      videoEl.style.display = "none";
      if (imgEl) imgEl.style.display = "block";
    });
  });

  currentFaqVideoId = faqId;
}

async function reiniciarConversa() {
  const chat = document.getElementById("chatBody");
  if (chat) {
    chat.innerHTML = "";
  }

  const avatarSuggestions = document.getElementById("chatAvatarSuggestions");
  if (avatarSuggestions) {
    avatarSuggestions.innerHTML = "";
  }

  if (chat) {
    chat
      .querySelectorAll(".suggested-questions-bar, .sugestoes-title")
      .forEach((el) => el.remove());
  }

  // Recarregar imagem do avatar para "refrescar" visualmente
  const avatarVideo = document.querySelector(".chat-avatar-video");
  if (avatarVideo) {
    try {
      avatarVideo.pause();
    } catch (e) {}
    try {
      avatarVideo.playbackRate = 1.0;
      avatarVideo.defaultPlaybackRate = 1.0;
      avatarVideo.currentTime = 0;
    } catch (e) {}
    avatarVideo.style.display = "none";
  }
  const avatarImg = document.querySelector(".chat-avatar-image");
  if (avatarImg) {
    avatarImg.style.display = "block";
    const srcBase = avatarImg.src.split("?")[0];
    avatarImg.src = srcBase + "?t=" + Date.now();
  }
  currentFaqVideoId = null;

  // Allow greeting to play again after restart
  try {
    hasPlayedGreeting = false;
  } catch (e) {}

  initialMessageShown = false;
  limparTimersAutoChat();
  try {
    await apresentarMensagemInicial(true); // Force update when restarting conversation
  } catch (e) {}

  // Immediately restart avatar video flow (greeting -> idle)
  try {
    if (avatarAtivo && typeof tocarAvatarVideo === "function") {
      tocarAvatarVideo();
    }
  } catch (e) {}
  iniciarTimerAutoMensagem();
}

async function atualizarNomeChatHeader() {
  const headerNome = document.getElementById("chatHeaderNomeBot");

  const headerImg = document.querySelector(".chat-header-avatar");
  const avatarImg = document.querySelector(".chat-avatar-image");
  let nomeBot = localStorage.getItem("nomeBot") || "Assistente Municipal";
  let corBot = localStorage.getItem("corChatbot") || "#d4af37";
  let iconBot =
    localStorage.getItem("iconBot") ||
    "/static/images/chatbot/chatbot-icon.png";
  const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
  if (chatbotId && !isNaN(chatbotId)) {
    try {
      const res = await fetch(`/chatbots/${chatbotId}`);
      if (!res.ok) {
        // Chatbot doesn't exist (404) or other error - clear chatbotAtivo and video paths
        if (res.status === 404) {
          localStorage.removeItem("chatbotAtivo");
          localStorage.removeItem("videoGreetingPath");
          localStorage.removeItem("videoIdlePath");
          // Reset to defaults
          nomeBot = "Assistente Municipal";
          corBot = "#d4af37";
          iconBot = "/static/images/chatbot/chatbot-icon.png";
          localStorage.setItem("nomeBot", nomeBot);
          localStorage.setItem("corChatbot", corBot);
          localStorage.setItem("iconBot", iconBot);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.success && data.nome) {
        nomeBot = data.nome;
        localStorage.setItem("nomeBot", nomeBot);
      }
      if (data.success && data.cor) {
        corBot = data.cor;
        localStorage.setItem("corChatbot", corBot);
      }
      if (data.success && data.icon) {
        iconBot = data.icon;
        localStorage.setItem("iconBot", iconBot);
        if (headerImg) {
          headerImg.src = iconBot;
        }
      }
      // Store video paths (can be null if videos not generated yet)
      if (data.success) {
        if (data.video_greeting_path) {
          localStorage.setItem("videoGreetingPath", data.video_greeting_path);
        } else {
          localStorage.removeItem("videoGreetingPath");
        }
        if (data.video_idle_path) {
          localStorage.setItem("videoIdlePath", data.video_idle_path);
        } else {
          localStorage.removeItem("videoIdlePath");
        }
      }
    } catch (e) {
      // If fetch failed (404, network error, etc.), check if chatbot still exists in local data
      const botsData = JSON.parse(localStorage.getItem("chatbotsData") || "[]");
      const bot = botsData.find(
        (b) => b.chatbot_id === chatbotId || b.chatbot_id === String(chatbotId),
      );
      if (bot && bot.nome) {
        nomeBot = bot.nome;
        localStorage.setItem("nomeBot", nomeBot);
      } else {
        // Bot not found in local data either - clear chatbotAtivo and video paths
        localStorage.removeItem("chatbotAtivo");
        localStorage.removeItem("videoGreetingPath");
        localStorage.removeItem("videoIdlePath");
        nomeBot = "Assistente Municipal";
        corBot = "#d4af37";
        iconBot = "/static/images/chatbot/chatbot-icon.png";
        localStorage.setItem("nomeBot", nomeBot);
        localStorage.setItem("corChatbot", corBot);
        localStorage.setItem("iconBot", iconBot);
      }
      if (bot && bot.cor) {
        corBot = bot.cor;
        localStorage.setItem("corChatbot", corBot);
      }
      if (bot && bot.icon_path) {
        iconBot = bot.icon_path;
        localStorage.setItem("iconBot", iconBot);
        if (headerImg) {
          headerImg.src = iconBot;
        }
      } else if (!bot) {
        // Bot not found, use default icon
        iconBot = "/static/images/chatbot/chatbot-icon.png";
        localStorage.setItem("iconBot", iconBot);
        if (headerImg) {
          headerImg.src = iconBot;
        }
      }
    }
  } else {
    // No chatbot active - clear video paths
    localStorage.removeItem("videoGreetingPath");
    localStorage.removeItem("videoIdlePath");
  }
  if (headerNome) {
    headerNome.textContent =
      nomeBot !== "..." ? nomeBot : "Assistente Municipal";
  }
  if (headerImg) {
    headerImg.src = iconBot;
  }
  if (avatarImg) {
    // keep inner avatar image in sync with chosen bot icon
    avatarImg.src = iconBot;
  }
  atualizarIconesChatbot(iconBot);
  const chatHeader = document.querySelector(".chat-header");
  if (chatHeader) {
    chatHeader.style.background = corBot;
  }
  atualizarFonteBadge();
  atualizarCorChatbot();
  // setupAvatarVideo() is called in apresentarMensagemInicial() after videos are loaded
  // Don't call it here to avoid race conditions
}

function atualizarFonteBadge() {
  const badgeDiv = document.getElementById("chatFonteBadge");
  const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
  if (!badgeDiv) return;
  if (!chatbotId || isNaN(chatbotId)) {
    badgeDiv.innerHTML = "";
    return;
  }
  const fonte =
    localStorage.getItem(`fonteSelecionada_bot${chatbotId}`) || "faq";
  let badgeHTML = "";
  if (fonte === "faq" || fonte === "faiss") {
    badgeHTML = `
      <span style="display:inline-flex;align-items:center;gap:7px;font-weight:500;font-size:14px;color:#fff;border-radius:7px;padding:3px 7px 3px 2px;margin-top:4px;margin-left: 0px;">
        <img src="/static/images/ui/imediato.png" alt="Imediato" style="width:18px;height:18px;object-fit:contain;">
        Respostas imediatas.
      </span>
    `;
  } else if (fonte === "faq+raga") {
    badgeHTML = `
      <span style="display:inline-flex;align-items:center;gap:7px;font-weight:500;font-size:14px;color:#fff;border-radius:7px;padding:3px 7px 3px 2px;margin-top:4px;margin-left:20px;">
        <img src="/static/images/ui/ia.png" alt="IA" style="width:18px;height:18px;object-fit:contain;">
        Baseado em IA.
      </span>
    `;
  }
  badgeDiv.innerHTML = badgeHTML;
}

function criarBlocoFeedback(msgId) {
  return `
    <div class="feedback-icons" data-msg-id="${msgId}">
      <img src="/static/images/ui/like.png" class="like-btn" title="Boa resposta" alt="Like">
      <img src="/static/images/ui/dislike.png" class="dislike-btn" title="Má resposta" alt="Dislike">
      <span class="feedback-label" style="display:none;"></span>
    </div>
  `;
}

function isSaudacao(msg) {
  if (!msg) return false;
  const s = msg
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const saudacoes = [
    "olá",
    "ola",
    "bom dia",
    "boa tarde",
    "boa noite",
    "hello",
    "hi",
    "good morning",
    "good afternoon",
    "good evening",
  ];
  for (let saud of saudacoes) {
    if (s === saud || s.startsWith(saud)) return true;
  }
  return false;
}

function adicionarMensagem(
  tipo,
  texto,
  avatarUrl = null,
  autor = null,
  timestamp = null,
  isRgpd = false,
) {
  const chat = document.getElementById("chatBody");
  let wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${tipo}${isRgpd ? " rgpd-wrapper" : ""}`;

  if (!isRgpd) {
    const authorDiv = document.createElement("div");
    authorDiv.className = "chat-author " + tipo;
    authorDiv.textContent =
      tipo === "user" ? "Eu" : autor || "Assistente Municipal";
    wrapper.appendChild(authorDiv);
  }

  const messageContent = document.createElement("div");
  messageContent.className = "message-content";

  if (tipo === "bot" && avatarUrl && !isRgpd) {
    const avatarDiv = document.createElement("div");
    avatarDiv.className = "bot-avatar-outer";
    const avatar = document.createElement("img");
    avatar.src = avatarUrl;
    avatar.alt = "Bot";
    avatar.className = "bot-avatar";
    avatarDiv.appendChild(avatar);
    messageContent.appendChild(avatarDiv);
  }

  const bubbleCol = document.createElement("div");
  bubbleCol.style.display = "flex";
  bubbleCol.style.flexDirection = "column";
  bubbleCol.style.alignItems = tipo === "user" ? "flex-end" : "flex-start";

  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${tipo}${isRgpd ? " rgpd" : ""}`;
  msgDiv.style.whiteSpace = "pre-line";
  msgDiv.textContent = texto;

  let corBot = localStorage.getItem("corChatbot") || "#d4af37";
  if (tipo === "bot" && !isRgpd) {
    msgDiv.style.backgroundColor = corBot;
    msgDiv.style.color = "#fff";
  }
  if (tipo === "user" && !isRgpd) {
    msgDiv.style.backgroundColor = shadeColor(corBot, -18);
    msgDiv.style.color = "#fff";
  }

  bubbleCol.appendChild(msgDiv);

  const customPos =
    !isRgpd &&
    tipo === "bot" &&
    localStorage.getItem("mensagemFeedbackPositiva")
      ? (localStorage.getItem("mensagemFeedbackPositiva") || "").trim()
      : "";
  const customNeg =
    !isRgpd &&
    tipo === "bot" &&
    localStorage.getItem("mensagemFeedbackNegativa")
      ? (localStorage.getItem("mensagemFeedbackNegativa") || "").trim()
      : "";
  const customNoAnswer =
    !isRgpd && tipo === "bot" && localStorage.getItem("mensagemSemResposta")
      ? (localStorage.getItem("mensagemSemResposta") || "").trim()
      : "";

  const isCannedFeedback =
    texto === "Fico contente por ter ajudado." ||
    texto ===
      "Lamento não ter conseguido responder. Tente reformular a pergunta." ||
    texto === "I'm glad I could help." ||
    texto ===
      "I'm sorry I couldn't answer. Please try rephrasing the question." ||
    (customPos && texto === customPos) ||
    (customNeg && texto === customNeg) ||
    (customNoAnswer && texto === customNoAnswer);

  if (!isRgpd && tipo === "bot" && !isCannedFeedback && !isSaudacao(texto)) {
    const feedbackId = "feedback-" + Math.random().toString(36).substr(2, 9);
    const feedbackDiv = document.createElement("div");
    feedbackDiv.innerHTML = criarBlocoFeedback(feedbackId);
    bubbleCol.appendChild(feedbackDiv);
  }

  if (!isRgpd && !timestamp) timestamp = gerarDataHoraFormatada();
  if (!isRgpd) {
    const timestampDiv = document.createElement("div");
    timestampDiv.className = "chat-timestamp";
    timestampDiv.textContent = timestamp;
    bubbleCol.appendChild(timestampDiv);
  }

  messageContent.appendChild(bubbleCol);
  wrapper.appendChild(messageContent);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;

  if (!isRgpd) {
    setTimeout(() => {
      document.querySelectorAll(".feedback-icons").forEach((feedback) => {
        if (!feedback.dataset.eventBound) {
          feedback.dataset.eventBound = true;
          const likeBtn = feedback.querySelector(".like-btn");
          const dislikeBtn = feedback.querySelector(".dislike-btn");
          const label = feedback.querySelector(".feedback-label");
          likeBtn.onclick = () => {
            if (
              label.nextElementSibling &&
              label.nextElementSibling.classList.contains("feedback-badge")
            ) {
              label.nextElementSibling.remove();
            }
            label.style.display = "none";
            const badge = document.createElement("div");
            badge.className = "feedback-badge positive";
            badge.innerHTML = `<div class="feedback-line"></div><div class="feedback-label-box">Boa resposta</div>`;
            label.parentNode.insertBefore(badge, label.nextSibling);
            likeBtn.classList.add("active");
            dislikeBtn.classList.remove("active");
          };
          dislikeBtn.onclick = () => {
            if (
              label.nextElementSibling &&
              label.nextElementSibling.classList.contains("feedback-badge")
            ) {
              label.nextElementSibling.remove();
            }
            label.style.display = "none";
            const badge = document.createElement("div");
            badge.className = "feedback-badge negative";
            badge.innerHTML = `<div class="feedback-line"></div><div class="feedback-label-box">Má resposta</div>`;
            label.parentNode.insertBefore(badge, label.nextSibling);
            dislikeBtn.classList.add("active");
            likeBtn.classList.remove("active");
          };
        }
      });
    }, 10);
  }
}

function adicionarFeedbackResolvido(
  onClick,
  idioma = "pt",
  isSaudacaoMsg = false,
) {
  if (isSaudacaoMsg) return;
  const chat = document.getElementById("chatBody");
  const wrapper = document.createElement("div");
  wrapper.className = "message-wrapper bot feedback-resolvido";
  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  const bubbleCol = document.createElement("div");
  bubbleCol.style.display = "flex";
  bubbleCol.style.flexDirection = "column";
  bubbleCol.style.alignItems = "flex-start";
  const msgDiv = document.createElement("div");
  msgDiv.className = "message bot";
  let corBot = localStorage.getItem("corChatbot") || "#d4af37";
  msgDiv.style.backgroundColor = corBot;
  msgDiv.style.color = "#fff";
  msgDiv.style.display = "flex";
  msgDiv.style.alignItems = "center";
  let textoPergunta = "A sua questão foi resolvida?";
  let btnSim = "Sim";
  let btnNao = "Não";
  if (idioma === "en") {
    textoPergunta = "Was your issue resolved?";
    btnSim = "Yes";
    btnNao = "No";
  }
  msgDiv.innerHTML = `
    <span style="font-weight: 500;">${textoPergunta}</span>
    <button class="btn-feedback-sim" style="margin-left:12px; margin-right:6px; background: #fff; color:${corBot}; border: 1.5px solid ${corBot}; border-radius: 6px; padding: 4px 14px; font-weight: 600; cursor:pointer; transition:0.18s;">${btnSim}</button>
    <button class="btn-feedback-nao" style="background: #fff; color:${corBot}; border: 1.5px solid ${corBot}; border-radius: 6px; padding: 4px 14px; font-weight: 600; cursor:pointer; transition:0.18s;">${btnNao}</button>
  `;
  bubbleCol.appendChild(msgDiv);
  messageContent.appendChild(bubbleCol);
  wrapper.appendChild(messageContent);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
  setTimeout(() => {
    msgDiv.querySelector(".btn-feedback-sim").onclick = function () {
      if (typeof onClick === "function") onClick("sim", wrapper);
      wrapper.remove();
    };
    msgDiv.querySelector(".btn-feedback-nao").onclick = function () {
      if (typeof onClick === "function") onClick("nao", wrapper);
      wrapper.remove();
    };
  }, 60);
}

let autoMensagemTimeout = null;
let autoFecharTimeout = null;
let initialMessageShown = false;
function iniciarTimerAutoMensagem() {
  limparTimersAutoChat();
  autoMensagemTimeout = setTimeout(() => {
    enviarMensagemAutomatica();
  }, 30000);
}

function enviarMensagemAutomatica() {
  adicionarMensagem(
    "bot",
    "Se precisar de ajuda, basta escrever a sua pergunta!",
    localStorage.getItem("iconBot") ||
      "/static/images/chatbot/chatbot-icon.png",
    localStorage.getItem("nomeBot") || "Assistente Municipal",
  );
  autoFecharTimeout = setTimeout(() => {
    fecharChat();
  }, 15000);
}

function limparTimersAutoChat() {
  if (autoMensagemTimeout) {
    clearTimeout(autoMensagemTimeout);
    autoMensagemTimeout = null;
  }
  if (autoFecharTimeout) {
    clearTimeout(autoFecharTimeout);
    autoFecharTimeout = null;
  }
}

async function abrirChat() {
  document.getElementById("chatSidebar").style.display = "flex";
  // Ensure there is a globally active chatbot selected (for fresh browsers / public users).
  try {
    if (typeof ensureActiveChatbot === "function") {
      await ensureActiveChatbot();
    }
  } catch (e) {}
  // Evitar race conditions: primeiro carregar dados do bot ativo, depois renderizar mensagem inicial
  try {
    if (typeof atualizarNomeChatHeader === "function") {
      await atualizarNomeChatHeader();
    }
  } catch (e) {}
  try {
    // Check if chatbot changed since last message - if so, force update
    const lastChatbotId = localStorage.getItem("lastPresentedChatbotId");
    const currentChatbotId = localStorage.getItem("chatbotAtivo") || "";
    const forceUpdate = lastChatbotId !== currentChatbotId;
    await apresentarMensagemInicial(forceUpdate);
  } catch (e) {}
  iniciarTimerAutoMensagem();
  atualizarCorChatbot();
  const toggleCard = document.querySelector(".chat-toggle-card");
  if (toggleCard) toggleCard.style.display = "none";
}
window.fecharChat = function () {
  document.getElementById("chatSidebar").style.display = "none";
  limparTimersAutoChat();
  const toggleCard = document.querySelector(".chat-toggle-card");
  if (toggleCard) toggleCard.style.display = "";
};

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape" || event.key === "Esc") {
    const sidebar = document.getElementById("chatSidebar");
    if (sidebar && sidebar.style.display !== "none") {
      fecharChat();
    }
  }
});

async function apresentarMensagemInicial(forceUpdate = false) {
  // If message was already shown and we're not forcing an update, check if chatbot changed
  if (initialMessageShown && !forceUpdate) {
    const lastChatbotId = localStorage.getItem("lastPresentedChatbotId");
    const currentChatbotId = localStorage.getItem("chatbotAtivo") || "";
    // If chatbot hasn't changed, don't update
    if (lastChatbotId === currentChatbotId) {
      return;
    }
    // Chatbot changed - clear old messages and reset flag
    const chat = document.getElementById("chatBody");
    if (chat) {
      chat.innerHTML = "";
    }
    initialMessageShown = false;
  }

  let nomeBot, corBot, iconBot, generoBot;
  let chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
  if (!chatbotId || isNaN(chatbotId)) {
    try {
      if (typeof ensureActiveChatbot === "function") {
        await ensureActiveChatbot();
        chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
      }
    } catch (e) {}
  }
  if (chatbotId && !isNaN(chatbotId)) {
    try {
      const res = await fetch(`/chatbots/${chatbotId}`);
      const data = await res.json();
      nomeBot = data.success && data.nome ? data.nome : "Assistente Municipal";
      corBot = data.success && data.cor ? data.cor : "#d4af37";
      iconBot =
        data.success && data.icon
          ? data.icon
          : "/static/images/chatbot/chatbot-icon.png";
      generoBot = data.success && data.genero ? data.genero : "";
      // Store video paths (can be null if videos not generated yet)
      if (data.success) {
        if (data.video_greeting_path) {
          localStorage.setItem("videoGreetingPath", data.video_greeting_path);
        } else {
          localStorage.removeItem("videoGreetingPath");
        }
        if (data.video_idle_path) {
          localStorage.setItem("videoIdlePath", data.video_idle_path);
        } else {
          localStorage.removeItem("videoIdlePath");
        }
        if (data.video_positive_path) {
          localStorage.setItem("videoPositivePath", data.video_positive_path);
        } else {
          localStorage.removeItem("videoPositivePath");
        }
        if (data.video_negative_path) {
          localStorage.setItem("videoNegativePath", data.video_negative_path);
        } else {
          localStorage.removeItem("videoNegativePath");
        }
        if (data.video_no_answer_path) {
          localStorage.setItem("videoNoAnswerPath", data.video_no_answer_path);
        } else {
          localStorage.removeItem("videoNoAnswerPath");
        }

        // Store customizable texts (used by chat UI). Keep empty string when missing.
        try {
          localStorage.setItem(
            "mensagemSemResposta",
            (data.mensagem_sem_resposta || "").trim(),
          );
          localStorage.setItem(
            "mensagemInicial",
            (data.mensagem_inicial || "").trim(),
          );
          localStorage.setItem(
            "mensagemFeedbackPositiva",
            (data.mensagem_feedback_positiva || "").trim(),
          );
          localStorage.setItem(
            "mensagemFeedbackNegativa",
            (data.mensagem_feedback_negativa || "").trim(),
          );
          localStorage.setItem(
            "mensagemGeradaAI",
            (data.mensagem_gerada_ai || "").trim(),
          );
        } catch (e) {}

        // Make chat language follow the chatbot language by default.
        try {
          const botIdioma = (data.idioma || "").trim().toLowerCase();
          if (botIdioma) {
            if (typeof window.setIdiomaAtivo === "function") {
              window.setIdiomaAtivo(botIdioma);
            } else {
              localStorage.setItem("idiomaAtivo", botIdioma);
            }
          }
        } catch (e) {}
      }
      localStorage.setItem("nomeBot", nomeBot);
      localStorage.setItem("corChatbot", corBot);
      localStorage.setItem("iconBot", iconBot);
      localStorage.setItem("generoBot", generoBot || "");

      // Setup avatar video after videos are loaded (only if chat is open)
      const chatSidebar = document.getElementById("chatSidebar");
      if (chatSidebar && chatSidebar.style.display !== "none") {
        setupAvatarVideo();
      }
    } catch (e) {
      const botsData = JSON.parse(localStorage.getItem("chatbotsData") || "[]");
      const bot = botsData.find(
        (b) => b.chatbot_id === chatbotId || b.chatbot_id === String(chatbotId),
      );
      nomeBot = bot && bot.nome ? bot.nome : "Assistente Municipal";
      corBot = bot && bot.cor ? bot.cor : "#d4af37";
      iconBot =
        bot && bot.icon_path
          ? bot.icon_path
          : "/static/images/chatbot/chatbot-icon.png";
      generoBot = bot && bot.genero ? bot.genero : "";
      localStorage.setItem("nomeBot", nomeBot);
      localStorage.setItem("corChatbot", corBot);
      localStorage.setItem("iconBot", iconBot);
      localStorage.setItem("generoBot", generoBot || "");

      // Setup avatar video even if fetch failed (only if chat is open)
      const chatSidebar = document.getElementById("chatSidebar");
      if (chatSidebar && chatSidebar.style.display !== "none") {
        setupAvatarVideo();
      }
    }
  } else {
    nomeBot = "Assistente Municipal";
    corBot = "#d4af37";
    iconBot = "/static/images/chatbot/chatbot-icon.png";
    generoBot = "";
    localStorage.setItem("nomeBot", nomeBot);
    localStorage.setItem("corChatbot", corBot);
    localStorage.setItem("iconBot", iconBot);
    localStorage.setItem("generoBot", generoBot || "");

    // Setup avatar video for default bot (only if chat is open)
    const chatSidebar = document.getElementById("chatSidebar");
    if (chatSidebar && chatSidebar.style.display !== "none") {
      setupAvatarVideo();
    }
  }
  atualizarCorChatbot();
  try {
    const avatarImg = document.querySelector(".chat-avatar-image");
    if (avatarImg) avatarImg.src = iconBot;
  } catch (e) {}

  // Store the chatbot ID that was used for this initial message
  localStorage.setItem(
    "lastPresentedChatbotId",
    chatbotId ? String(chatbotId) : "",
  );

  adicionarMensagem("bot", TEXTO_RGPD, null, null, null, true);

  const idioma = getIdiomaAtual();
  let msg;

  // If admin configured a custom initial message for this bot, use it.
  try {
    const customInit = (localStorage.getItem("mensagemInicial") || "").trim();
    if (customInit) {
      msg = customInit;
    }
  } catch (e) {}

  if (!msg) {
    if (idioma === "en") {
      msg = `Hello!
I'm ${nomeBot}, your virtual assistant.
Ask one question at a time and I will do my best to clarify your doubts.`;
    } else {
      const generoLocal = localStorage.getItem("generoBot") || generoBot || "";
      let artigoSou = "o";
      let artigoPossessivo = "o seu";
      if (generoLocal === "f") {
        artigoSou = "a";
        artigoPossessivo = "a sua";
      } else if (generoLocal === "") {
        artigoSou = "";
        artigoPossessivo = "o seu";
      }
      const prefixoSou = artigoSou
        ? `Eu sou ${artigoSou} ${nomeBot},`
        : `Eu sou ${nomeBot},`;
      msg = `Olá!
${prefixoSou} ${artigoPossessivo} assistente virtual.
Faça uma pergunta de cada vez, que eu procurarei esclarecer todas as suas dúvidas.`;
    }
  }
  adicionarMensagem("bot", msg, iconBot, nomeBot);
  initialMessageShown = true;
  await atualizarNomeChatHeader();
  mostrarPerguntasSugestivasDB();
}

function enviarPergunta() {
  const input = document.getElementById("chatInput");
  const texto = input.value.trim();
  if (!texto) return;
  adicionarMensagem("user", texto);
  input.value = "";
  limparTimersAutoChat();
  iniciarTimerAutoMensagem();
  responderPergunta(texto);
}

function escapeHtmlChat(valor) {
  return String(valor || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function responderPergunta(pergunta) {
  const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
  if (!chatbotId || isNaN(chatbotId)) {
    return adicionarMensagem(
      "bot",
      "⚠️ Nenhum chatbot está ativo neste momento. Tente novamente dentro de instantes.",
      localStorage.getItem("iconBot") ||
        "/static/images/chatbot/chatbot-icon.png",
      localStorage.getItem("nomeBot") || "Assistente Municipal",
    );
  }
  if (window.awaitingRagConfirmation) {
  const perguntaNormalizada = String(pergunta || "").trim().toLowerCase();

  if (perguntaNormalizada === "sim" || perguntaNormalizada === "yes") {
    adicionarMensagem(
      "bot",
      "Por favor, utilize o link acima para confirmar se pretende pesquisar nos documentos PDF.",
    );
    return;
  }

  window.awaitingRagConfirmation = false;
}
  const fonte =
    localStorage.getItem(`fonteSelecionada_bot${chatbotId}`) || "faq";
  const idioma = getIdiomaAtual();
  let corBot = localStorage.getItem("corChatbot") || "#d4af37";
  let iconBot =
    localStorage.getItem("iconBot") ||
    "/static/images/chatbot/chatbot-icon.png";
  fetch("/obter-resposta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pergunta,
      chatbot_id: chatbotId,
      fonte,
      idioma,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      let faqPergunta = data.pergunta_faq || pergunta;
      let faqIdioma = (data.faq_idioma || idioma || "pt").toLowerCase();
      if (data.success) {
        let resposta = data.resposta || "";

        // If backend signals this answer was generated by AI, show the admin-configured notice.
        try {
          const aiNotice = (data.ai_notice || "").trim();
          if (aiNotice && data.ai_generated) {
            resposta += `
              <div class="ai-notice" style="margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.35);">
                <span style="font-size: 13px; opacity: 0.95;">${aiNotice}</span>
              </div>
            `;
          }
        } catch (e) {}
        if (
          data.documentos &&
          Array.isArray(data.documentos) &&
          data.documentos.length > 0
        ) {
          const rawDoc = String(data.documentos[0] || "").trim();
          const isValidDocUrl =
            rawDoc.startsWith("/") || /^https?:\/\//i.test(rawDoc);
          if (isValidDocUrl) {
            resposta += `
              <div class="fonte-docs-wrapper" style="margin-top: 18px; display: flex; align-items: center; gap: 10px;">
                <span class="fonte-label" style="font-weight: 600; margin-right: 7px; color: #fff;">Fonte:</span>
                <a href="${rawDoc}" target="_blank" rel="noopener" class="fonte-doc-link"
                   style="background: #fff; color: ${corBot}; border-radius: 7px; padding: 6px 18px; text-decoration: none; font-weight: 600; border: 1.5px solid ${corBot}; transition: all 0.18s; font-size: 15px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer;"
                   onmouseover="this.style.background='${corBot}'; this.style.color='#fff'; this.style.borderColor='${corBot}';"
                   onmouseout="this.style.background='#fff'; this.style.color='${corBot}'; this.style.borderColor='${corBot}';"
                   title="Abrir fonte do documento em nova aba">
                  <span>Link</span>
                  <span style="font-size: 12px;">↗</span>
                </a>
              </div>
            `;
          }
        }
        {
          adicionarMensagemComHTML(
            "bot",
            resposta,
            iconBot,
            localStorage.getItem("nomeBot"),
          );
          if (data.faq_id) {
            try {
              // Only show video if video_enabled is true
              if (data.video_enabled) {
                if (data.video_status === "ready") {
                  mostrarVideoFaqNoAvatar(data.faq_id);
                } else if (
                  data.video_status === "queued" ||
                  data.video_status === "processing"
                ) {
                  // Only show spinner while the FAQ video is actually being generated.
                  mostrarSpinnerVideoFaq(data.faq_id);
                }
                // If video_status is null/undefined and not queued, don't show anything
              }
            } catch (e) {
              console.error("Erro ao processar vídeo da FAQ:", e);
            }
          }
          const saudacao = isSaudacao(faqPergunta) || isSaudacao(resposta);
          adicionarFeedbackResolvido(
            (respostaFeedback, bloco) => {
              const customPos = (
                localStorage.getItem("mensagemFeedbackPositiva") || ""
              ).trim();
              const customNeg = (
                localStorage.getItem("mensagemFeedbackNegativa") || ""
              ).trim();

              const defaultPos =
                faqIdioma === "en"
                  ? "I'm glad I could help."
                  : "Fico contente por ter ajudado.";
              const defaultNeg =
                faqIdioma === "en"
                  ? "I'm sorry I couldn't answer. Please try rephrasing the question."
                  : "Lamento não ter conseguido responder. Tente reformular a pergunta.";

              const posMsg = customPos || defaultPos;
              const negMsg = customNeg || defaultNeg;

              if (respostaFeedback === "sim") {
                adicionarMensagem(
                  "bot",
                  posMsg,
                  iconBot,
                  localStorage.getItem("nomeBot"),
                );
                try {
                  if (data.video_enabled) playChatbotAuxVideo("positive");
                } catch (e) {}
                obterPerguntasSemelhantes(faqPergunta, chatbotId, faqIdioma);
              } else if (respostaFeedback === "nao") {
                adicionarMensagem(
                  "bot",
                  negMsg,
                  iconBot,
                  localStorage.getItem("nomeBot"),
                );
                try {
                  if (data.video_enabled) playChatbotAuxVideo("negative");
                } catch (e) {}
                obterPerguntasSemelhantes(faqPergunta, chatbotId, faqIdioma);
              }
            },
            faqIdioma,
            saudacao,
          );
        }
        window.awaitingRagConfirmation = false;
      } else if (
        data.prompt_rag ||
        (data.erro &&
          data.erro
            .toLowerCase()
            .includes(
              "deseja tentar encontrar uma resposta nos documentos pdf",
            ))
      ) {
        window.awaitingRagConfirmation = true;
        const chat = document.getElementById("chatBody");
        let wrapper = document.createElement("div");
        wrapper.className = "message-wrapper bot";
        const authorDiv = document.createElement("div");
        authorDiv.className = "chat-author bot";
        authorDiv.textContent =
          localStorage.getItem("nomeBot") || "Assistente Municipal";
        wrapper.appendChild(authorDiv);
        const messageContent = document.createElement("div");
        messageContent.className = "message-content";
        const bubbleCol = document.createElement("div");
        bubbleCol.style.display = "flex";
        bubbleCol.style.flexDirection = "column";
        bubbleCol.style.alignItems = "flex-start";
        const msgDiv = document.createElement("div");
        msgDiv.className = "message bot";
        msgDiv.style.whiteSpace = "pre-line";
        msgDiv.style.backgroundColor = corBot;
        msgDiv.style.color = "#fff";
        const sugestoesFaq = Array.isArray(data.sugestoes_faq)
  ? data.sugestoes_faq
  : [];

const sugestoesHtml = sugestoesFaq.length
  ? `
    <div style="margin-top: 8px; margin-bottom: 10px;">
      <div style="font-size: 14px; margin-bottom: 7px;">
        Não encontrei uma resposta exata nas FAQs, mas encontrei algumas opções relacionadas:
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${sugestoesFaq
          .map((item, index) => {
            const perguntaSugestao = escapeHtmlChat(item.pergunta);
            return `
              <button class="faq-sugestao-link"
                data-pergunta="${perguntaSugestao}"
                style="
                  background: #fff;
                  color: ${corBot};
                  border: 1.5px solid #fff;
                  border-radius: 7px;
                  padding: 7px 10px;
                  text-align: left;
                  cursor: pointer;
                  font-weight: 600;
                  font-size: 14px;">
                ${index + 1}. ${perguntaSugestao}
              </button>
            `;
          })
          .join("")}
      </div>
      <div style="font-size: 13px; opacity: .9; margin-top: 8px;">
        Pode clicar numa das opções acima ou tentar pesquisar nos documentos PDF.
      </div>
    </div>
  `
  : `Pergunta não encontrada nas FAQs.<br>`;
        msgDiv.innerHTML = `${sugestoesHtml}
        <a id="confirmar-rag-link" href="#" style="
          color: #fff; background: ${corBot}; border: 2px solid #fff;
          border-radius: 8px; padding: 5px 17px; font-weight: bold;
          text-decoration: underline; display: inline-block; margin-top: 7px; cursor: pointer;"
        >Clique aqui para tentar encontrar uma resposta nos documentos PDF.</a>
        <br><span style="font-size:13px; opacity:.86;">Pode demorar alguns segundos.</span>`;
        bubbleCol.appendChild(msgDiv);
        const timestampDiv = document.createElement("div");
        timestampDiv.className = "chat-timestamp";
        timestampDiv.textContent = gerarDataHoraFormatada();
        bubbleCol.appendChild(timestampDiv);
        messageContent.appendChild(bubbleCol);
        wrapper.appendChild(messageContent);
        chat.appendChild(wrapper);
        chat.scrollTop = chat.scrollHeight;
        setTimeout(() => {
          document.querySelectorAll(".faq-sugestao-link").forEach((btn) => {
  btn.onclick = function (e) {
    e.preventDefault();

    const perguntaSugestao = this.getAttribute("data-pergunta");
    if (!perguntaSugestao) return;

    window.awaitingRagConfirmation = false;

    adicionarMensagem("user", perguntaSugestao);
    responderPergunta(perguntaSugestao);
  };
});
          const confirmarRag = document.getElementById("confirmar-rag-link");
          if (confirmarRag) {
            confirmarRag.onclick = function (e) {
              e.preventDefault();
              window.awaitingRagConfirmation = false;
              confirmarRag.style.pointerEvents = "none";
              confirmarRag.style.opacity = "0.6";
              confirmarRag.textContent = "A procurar nos documentos PDF...";
              fetch("/obter-resposta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  pergunta,
                  chatbot_id: chatbotId,
                  fonte: "faq+raga",
                  feedback: "try_rag",
                  idioma,
                }),
              })
                .then((res) => res.json())
                .then((ragData) => {
                  if (ragData.success) {
                    adicionarMensagemComHTML(
                      "bot",
                      ragData.resposta || "",
                      iconBot,
                      localStorage.getItem("nomeBot"),
                    );
                  } else {
                    adicionarMensagem(
                      "bot",
                      ragData.erro ||
                        "❌ Nenhuma resposta encontrada nos documentos PDF.",
                      iconBot,
                      localStorage.getItem("nomeBot"),
                    );
                  }
                })
                .catch(() => {
                  adicionarMensagem(
                    "bot",
                    "❌ Erro ao comunicar com o servidor (RAG).",
                    iconBot,
                    localStorage.getItem("nomeBot"),
                  );
                });
            };
          }
        }, 60);
      } else {
        adicionarMensagem(
          "bot",
          data.erro ||
            "❌ Nenhuma resposta encontrada para a pergunta fornecida.",
          iconBot,
          localStorage.getItem("nomeBot"),
        );

        // Play no-answer video when backend marks it as such (if available)
        try {
          if (data.no_answer) playChatbotAuxVideo("no_answer");
        } catch (e) {}
        window.awaitingRagConfirmation = false;
      }
    })
    .catch(() => {
      adicionarMensagem(
        "bot",
        "❌ Erro ao comunicar com o servidor. Verifique se o servidor está ativo.",
        iconBot,
        localStorage.getItem("nomeBot"),
      );
      window.awaitingRagConfirmation = false;
    });
}

async function playChatbotAuxVideo(kind) {
  if (!avatarAtivo) return;
  const avatarPanel = document.getElementById("chatAvatarPanel");
  if (!avatarPanel) return;
  const avatarInner = avatarPanel.querySelector(".chat-avatar-inner");
  if (!avatarInner) return;
  const videoEl = avatarInner.querySelector("video.chat-avatar-video");
  const imgEl = avatarInner.querySelector("img.chat-avatar-image");
  if (!videoEl) return;

  let pathKey = null;
  if (kind === "positive") pathKey = "videoPositivePath";
  if (kind === "negative") pathKey = "videoNegativePath";
  if (kind === "no_answer") pathKey = "videoNoAnswerPath";
  if (!pathKey) return;

  const src = localStorage.getItem(pathKey);
  if (!src) return;

  try {
    videoEl.pause();
  } catch (e) {}

  videoEl.src = src;
  videoEl.style.display = "block";
  videoEl.loop = false;
  videoEl.muted = isAvatarSoundMuted() ? true : false;
  if (imgEl) imgEl.style.display = "none";

  const onEnded = () => {
    try {
      videoEl.removeEventListener("ended", onEnded);
    } catch (e) {}
    const idlePath = localStorage.getItem("videoIdlePath");
    if (idlePath) {
      try {
        videoEl.pause();
      } catch (e) {}
      videoEl.src = idlePath;
      videoEl.loop = true;
      videoEl.muted = true;
      try {
        videoEl.playbackRate = 0.3;
      } catch (e) {}
      videoEl.play().catch(() => {
        videoEl.style.display = "none";
        if (imgEl) imgEl.style.display = "block";
      });
    } else {
      videoEl.style.display = "none";
      if (imgEl) imgEl.style.display = "block";
    }
  };
  videoEl.addEventListener("ended", onEnded);

  try {
    videoEl.load();
  } catch (e) {}

  videoEl.play().catch(() => {
    // Autoplay fallback
    videoEl.muted = true;
    videoEl.play().catch(() => {
      videoEl.style.display = "none";
      if (imgEl) imgEl.style.display = "block";
    });
  });
}

function adicionarMensagemComHTML(
  tipo,
  html,
  avatarUrl = null,
  autor = null,
  timestamp = null,
) {
  const chat = document.getElementById("chatBody");
  let wrapper = document.createElement("div");
  wrapper.className = "message-wrapper " + tipo;
  const authorDiv = document.createElement("div");
  authorDiv.className = "chat-author " + tipo;
  authorDiv.textContent =
    tipo === "user" ? "Eu" : autor || "Assistente Municipal";
  wrapper.appendChild(authorDiv);
  const messageContent = document.createElement("div");
  messageContent.className = "message-content";
  if (tipo === "bot" && avatarUrl) {
    const avatarDiv = document.createElement("div");
    avatarDiv.className = "bot-avatar-outer";
    const avatar = document.createElement("img");
    avatar.src = avatarUrl;
    avatar.alt = "Bot";
    avatar.className = "bot-avatar";
    avatarDiv.appendChild(avatar);
    messageContent.appendChild(avatarDiv);
  }
  const bubbleCol = document.createElement("div");
  bubbleCol.style.display = "flex";
  bubbleCol.style.flexDirection = "column";
  bubbleCol.style.alignItems = tipo === "user" ? "flex-end" : "flex-start";
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${tipo}`;
  msgDiv.style.whiteSpace = "pre-line";
  msgDiv.innerHTML = html;
  let corBot = localStorage.getItem("corChatbot") || "#d4af37";
  if (tipo === "bot") {
    msgDiv.style.backgroundColor = corBot;
    msgDiv.style.color = "#fff";
  }
  if (tipo === "user") {
    msgDiv.style.backgroundColor = shadeColor(corBot, -18);
    msgDiv.style.color = "#fff";
  }
  bubbleCol.appendChild(msgDiv);
  if (
    tipo === "bot" &&
    (() => {
      const customPos = (
        localStorage.getItem("mensagemFeedbackPositiva") || ""
      ).trim();
      const customNeg = (
        localStorage.getItem("mensagemFeedbackNegativa") || ""
      ).trim();
      const customNoAnswer = (
        localStorage.getItem("mensagemSemResposta") || ""
      ).trim();
      const isCanned =
        html === "Fico contente por ter ajudado." ||
        html ===
          "Lamento não ter conseguido responder. Tente reformular a pergunta." ||
        html === "I'm glad I could help." ||
        html ===
          "I'm sorry I couldn't answer. Please try rephrasing the question." ||
        (customPos && html === customPos) ||
        (customNeg && html === customNeg) ||
        (customNoAnswer && html === customNoAnswer);
      return !isCanned && !isSaudacao(html);
    })()
  ) {
    const feedbackId = "feedback-" + Math.random().toString(36).substr(2, 9);
    const feedbackDiv = document.createElement("div");
    feedbackDiv.innerHTML = criarBlocoFeedback(feedbackId);
    bubbleCol.appendChild(feedbackDiv);
  }
  if (!timestamp) timestamp = gerarDataHoraFormatada();
  const timestampDiv = document.createElement("div");
  timestampDiv.className = "chat-timestamp";
  timestampDiv.textContent = timestamp;
  bubbleCol.appendChild(timestampDiv);
  messageContent.appendChild(bubbleCol);
  wrapper.appendChild(messageContent);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
  setTimeout(() => {
    document.querySelectorAll(".feedback-icons").forEach((feedback) => {
      if (!feedback.dataset.eventBound) {
        feedback.dataset.eventBound = true;
        const likeBtn = feedback.querySelector(".like-btn");
        const dislikeBtn = feedback.querySelector(".dislike-btn");
        const label = feedback.querySelector(".feedback-label");
        likeBtn.onclick = () => {
          label.textContent = "Boa resposta";
          label.style.color = "#388e3c";
          label.style.display = "inline-block";
          likeBtn.style.opacity = 1;
          dislikeBtn.style.opacity = 0.3;
        };
        dislikeBtn.onclick = () => {
          label.textContent = "Má resposta";
          label.style.color = "#d32f2f";
          label.style.display = "inline-block";
          dislikeBtn.style.opacity = 1;
          likeBtn.style.opacity = 0.3;
        };
      }
    });
  }, 10);
}

function obterPerguntasSemelhantes(perguntaOriginal, chatbotId, idioma = null) {
  if (!chatbotId || isNaN(chatbotId)) return;
  if (!idioma) idioma = getIdiomaAtual();
  fetch("/perguntas-semelhantes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pergunta: perguntaOriginal,
      chatbot_id: chatbotId,
      idioma: idioma,
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      document
        .querySelectorAll(".sugestoes-similares")
        .forEach((el) => el.remove());
      if (
        data.success &&
        Array.isArray(data.sugestoes) &&
        data.sugestoes.length > 0
      ) {
        const chat = document.getElementById("chatBody");
        const sugestoesWrapper = document.createElement("div");
        sugestoesWrapper.className = "sugestoes-similares";
        sugestoesWrapper.style.marginTop = "10px";
        sugestoesWrapper.style.marginBottom = "8px";
        sugestoesWrapper.style.maxWidth = "540px";
        const titulo = document.createElement("div");
        titulo.className = "sugestoes-title";
        titulo.style.fontWeight = "600";
        titulo.style.fontSize = "15.5px";
        const corBot = localStorage.getItem("corChatbot") || "#d4af37";
        titulo.style.color = corBot;
        titulo.style.marginBottom = "7px";
        let sugestoesTitulo = "📌 Perguntas que também podem interessar:";
        if (idioma === "en") {
          sugestoesTitulo = "📌 Questions you might also be interested in:";
        }
        titulo.textContent = sugestoesTitulo;
        sugestoesWrapper.appendChild(titulo);
        const btnContainer = document.createElement("div");
        btnContainer.className = "suggested-questions-bar";
        data.sugestoes.forEach((pergunta) => {
          const btn = document.createElement("button");
          btn.className = "suggested-question-btn";
          btn.textContent = pergunta;
          btn.style.background = "#fff";
          btn.style.borderColor = corBot;
          btn.style.color = corBot;
          btn.onmouseover = () => {
            btn.style.background = corBot;
            btn.style.color = "#fff";
          };
          btn.onmouseout = () => {
            btn.style.background = "#fff";
            btn.style.color = corBot;
          };
          btn.onclick = () => {
            adicionarMensagem("user", pergunta);
            responderPergunta(pergunta);
            sugestoesWrapper.remove();
          };
          btnContainer.appendChild(btn);
        });
        sugestoesWrapper.appendChild(btnContainer);
        chat.appendChild(sugestoesWrapper);
        chat.scrollTop = chat.scrollHeight;
      }
    })
    .catch(() => {});
}

async function mostrarPerguntasSugestivasDB() {
  const container =
    document.getElementById("chatAvatarSuggestions") ||
    document.getElementById("chatBody");
  if (!container) return;

  // Se já existir uma barra de perguntas sugeridas ativa, não criar outra
  if (container.querySelector(".suggested-questions-bar")) {
    return;
  }
  const idioma = getIdiomaAtual();
  const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
  if (!chatbotId || isNaN(chatbotId)) return;
  try {
    const res = await fetch("/faqs-aleatorias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idioma: idioma,
        n: 3,
        chatbot_id: chatbotId,
      }),
    });
    const data = await res.json();
    if (data.success && data.faqs && data.faqs.length > 0) {
      const title = document.createElement("div");
      title.className = "sugestoes-title";
      title.textContent = "Possíveis perguntas:";
      const corBot = localStorage.getItem("corChatbot") || "#d4af37";
      title.style.color = corBot;
      container.appendChild(title);
      const btnContainer = document.createElement("div");
      btnContainer.className = "suggested-questions-bar";
      data.faqs.forEach((faq) => {
        const btn = document.createElement("button");
        btn.className = "suggested-question-btn";
        btn.textContent = faq.pergunta;
        btn.style.background = corBot + "15";
        btn.style.borderColor = corBot;
        btn.style.color = corBot;
        btn.onmouseover = () => {
          btn.style.background = corBot;
          btn.style.color = "#fff";
        };
        btn.onmouseout = () => {
          btn.style.background = corBot + "15";
          btn.style.color = corBot;
        };
        btn.onclick = () => {
          adicionarMensagem("user", faq.pergunta);
          responderPergunta(faq.pergunta);
          btn.remove();
          const aindaTemBotoes = btnContainer.querySelector(
            ".suggested-question-btn",
          );
          if (!aindaTemBotoes) {
            title.remove();
            btnContainer.remove();
          }
        };
        btnContainer.appendChild(btn);
      });
      container.appendChild(btnContainer);
      const chatBody = document.getElementById("chatBody");
      if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
    }
  } catch (e) {}
}

window.setIdiomaAtivo = function (idioma) {
  localStorage.setItem("idiomaAtivo", idioma);
};
window.apresentarMensagemInicial = apresentarMensagemInicial;
window.enviarPergunta = enviarPergunta;
window.responderPergunta = responderPergunta;
window.perguntarCategoria = function () {};
window.atualizarNomeChatHeader = atualizarNomeChatHeader;
window.atualizarFonteBadge = atualizarFonteBadge;
window.atualizarCorChatbot = atualizarCorChatbot;
window.reiniciarConversa = reiniciarConversa;

let hasPlayedGreeting = false;

async function ensureActiveChatbot() {
  // Global chatbot selection:
  // - If server has an active chatbot, always use it
  // - Otherwise keep local selection if valid
  // - Otherwise pick the first chatbot
  try {
    const res = await fetch("/chatbots");
    if (!res.ok) return false;
    const bots = await res.json();
    if (!Array.isArray(bots) || bots.length === 0) return false;

    try {
      localStorage.setItem("chatbotsData", JSON.stringify(bots));
    } catch (e) {}

    const embedId = EMBED_CHATBOT_ID;
    const embedBot = embedId
      ? bots.find((b) => String(b.chatbot_id) === String(embedId))
      : null;
    const serverActive = bots.find((b) => b && b.ativo);
    const localId = localStorage.getItem("chatbotAtivo");
    const localBot = bots.find((b) => String(b.chatbot_id) === String(localId));
    const chosen = embedBot || serverActive || localBot || bots[0];
    if (!chosen) return false;

    localStorage.setItem("chatbotAtivo", String(chosen.chatbot_id));
    try {
      window.chatbotAtivo = parseInt(chosen.chatbot_id);
    } catch (e) {}

    // Best-effort defaults so UI doesn't look empty before /chatbots/<id> fetch.
    localStorage.setItem("nomeBot", chosen.nome || "Assistente Municipal");
    localStorage.setItem("corChatbot", chosen.cor || "#d4af37");
    localStorage.setItem(
      "iconBot",
      chosen.icon_path || "/static/images/chatbot/chatbot-icon.png",
    );
    localStorage.setItem("generoBot", chosen.genero || "");
    if (chosen.fonte) {
      localStorage.setItem(
        `fonteSelecionada_bot${chosen.chatbot_id}`,
        chosen.fonte,
      );
    }
    return true;
  } catch (e) {
    return false;
  }
}

function setupAvatarVideo() {
  // Don't setup video if avatar is disabled
  if (!avatarAtivo) {
    const videoEl = document.querySelector(".chat-avatar-video");
    const imgEl = document.querySelector(".chat-avatar-image");
    if (videoEl) {
      videoEl.muted = true;
      videoEl.pause();
    }
    if (imgEl) {
      imgEl.style.display = "block";
    }
    return;
  }

  // Check if there's an active chatbot - if not, show static image
  const chatbotId = parseInt(localStorage.getItem("chatbotAtivo"));
  if (!chatbotId || isNaN(chatbotId)) {
    const videoEl = document.querySelector(".chat-avatar-video");
    const imgEl = document.querySelector(".chat-avatar-image");
    if (videoEl) {
      videoEl.style.display = "none";
      videoEl.pause();
      videoEl.src = "";
    }
    if (imgEl) {
      imgEl.style.display = "block";
    }
    // Clear video paths when no chatbot is active
    localStorage.removeItem("videoGreetingPath");
    localStorage.removeItem("videoIdlePath");
    return;
  }

  const videoEl = document.querySelector(".chat-avatar-video");
  const imgEl = document.querySelector(".chat-avatar-image");
  if (!videoEl || !imgEl) return;

  // Don't interfere if a FAQ video is currently playing or if idle video is already playing
  if (
    currentFaqVideoId !== null &&
    videoEl.src &&
    videoEl.src.includes("/video/faq/")
  ) {
    return;
  }
  // If idle video is already playing, don't interfere
  if (
    videoEl.src &&
    videoEl.src.includes("/idle") &&
    videoEl.loop &&
    !videoEl.paused
  ) {
    return;
  }

  const greetingPath = localStorage.getItem("videoGreetingPath");
  const idlePath = localStorage.getItem("videoIdlePath");

  // If no videos at all, show static image
  if (!greetingPath && !idlePath) {
    videoEl.style.display = "none";
    imgEl.style.display = "block";
    return;
  }

  // Show video, hide img
  videoEl.style.display = "block";
  imgEl.style.display = "none";

  // Clear any previous event listeners
  const newVideoEl = videoEl.cloneNode(true);
  videoEl.parentNode.replaceChild(newVideoEl, videoEl);
  const currentVideoEl = document.querySelector(".chat-avatar-video");

  if (!hasPlayedGreeting && greetingPath) {
    // Play greeting first, then switch to idle
    // For greeting, try to play with sound (unmuted)
    currentVideoEl.src = greetingPath;
    currentVideoEl.loop = false;
    currentVideoEl.muted = isAvatarSoundMuted() ? true : false; // Greeting respects mute toggle
    try {
      currentVideoEl.playbackRate = 1.0;
    } catch (e) {}

    currentVideoEl.onloadeddata = () => {
      // Try to play with sound first
      currentVideoEl.play().catch(() => {
        // Browser blocked autoplay with sound, try muted
        if (!isAvatarSoundMuted()) {
          pendingSoundUnlock = true;
          ensureSoundUnlockListener();
        }
        currentVideoEl.muted = true;
        currentVideoEl.play().catch(() => {
          // Fallback to idle or image
          if (idlePath) {
            currentVideoEl.src = idlePath;
            currentVideoEl.loop = true;
            currentVideoEl.muted = true; // Idle should be muted
            try {
              currentVideoEl.playbackRate = 0.3;
            } catch (e) {}
            currentVideoEl.play().catch(() => {
              currentVideoEl.style.display = "none";
              if (imgEl) imgEl.style.display = "block";
            });
          } else {
            currentVideoEl.style.display = "none";
            if (imgEl) imgEl.style.display = "block";
          }
        });
      });
    };
    currentVideoEl.onended = async () => {
      hasPlayedGreeting = true;
      // Switch to idle (muted, as it's just animation)
      let idle = idlePath;
      if (!idle) {
        try {
          await refreshChatbotVideoUrls(chatbotId);
          idle = localStorage.getItem("videoIdlePath");
        } catch (e) {}
      }
      if (idle) {
        currentVideoEl.src = idle;
        currentVideoEl.loop = true;
        currentVideoEl.muted = true; // Idle should be muted
        try {
          currentVideoEl.playbackRate = 0.3;
        } catch (e) {}
        try {
          await currentVideoEl.play();
        } catch (e) {
          // Retry once with fresh signed URL
          try {
            await refreshChatbotVideoUrls(chatbotId);
            const freshIdle = localStorage.getItem("videoIdlePath");
            if (freshIdle) {
              currentVideoEl.src = freshIdle;
              currentVideoEl.loop = true;
              currentVideoEl.muted = true;
              try {
                currentVideoEl.playbackRate = 0.3;
              } catch (e) {}
              await currentVideoEl.play();
              return;
            }
          } catch (e2) {}
          currentVideoEl.style.display = "none";
          if (imgEl) imgEl.style.display = "block";
        }
      } else {
        // No idle video, show image
        currentVideoEl.style.display = "none";
        if (imgEl) imgEl.style.display = "block";
      }
    };
    // Trigger load if src was already set
    if (currentVideoEl.src) {
      currentVideoEl.load();
    }
  } else if (idlePath) {
    // Already played greeting or no greeting, show idle (muted)
    currentVideoEl.src = idlePath;
    currentVideoEl.loop = true;
    currentVideoEl.muted = true; // Idle should be muted
    currentVideoEl.onloadeddata = () => {
      try {
        currentVideoEl.playbackRate = 0.3;
      } catch (e) {}
      currentVideoEl.play().catch(() => {
        currentVideoEl.style.display = "none";
        if (imgEl) imgEl.style.display = "block";
      });
    };
    if (currentVideoEl.src) {
      currentVideoEl.load();
    }
  } else {
    // Only greeting available but already played, or no videos
    currentVideoEl.style.display = "none";
    if (imgEl) imgEl.style.display = "block";
  }
}
