"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Room } from "livekit-client";

interface STTState {
  isListening: boolean;
  interim: string;
  final: string;
}

export function useSTT(room: Room | null) {
  const [state, setState] = useState<STTState>({
    isListening: false,
    interim: "",
    final: "",
  });

  const roomRef = useRef(room);
  roomRef.current = room;
  const isListeningRef = useRef(false);

  const sendText = useCallback((text: string) => {
    const r = roomRef.current;
    if (!r || !text.trim()) return;
    r.localParticipant
      .publishData(
        new TextEncoder().encode(
          JSON.stringify({ channel: "text_input", text: text.trim() })
        ),
        { reliable: true }
      )
      .catch(console.error);
  }, []);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    setState({ isListening: false, interim: "", final: "" });
    // mic/MediaRecorder cleanup handled by auto-restart in useEffect
  }, []);

  const start = useCallback(async () => {
    if (isListeningRef.current) return;
    if (!roomRef.current || !process.env.NEXT_PUBLIC_DEEPGRAM_KEY) {
      console.error("[STT] No room or Deepgram key");
      return;
    }

    isListeningRef.current = true;
    setState({ isListening: true, interim: "", final: "" });

    try {
      // Ask for microphone.
      // Note: LiveKit room ALSO publishes mic audio, which the user already allowed.
      // We reuse the same MediaStream so there's no conflict.
      // Actually better to get our own track so LiveKit doesn't double-capture.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micTrack = stream.getAudioTracks()[0];

      const deepgramWs = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&punctuate=true&interim_results=true&smart_format=true&encoding=linear16&sample_rate=16000&channels=1`,
        ["token", process.env.NEXT_PUBLIC_DEEPGRAM_KEY]
      );

      let micProcessor: ScriptProcessorNode | null = null;
      let audioCtx: AudioContext | null = null;

      deepgramWs.onopen = () => {
        console.log("[STT] Deepgram connected");

        audioCtx = new AudioContext({ sampleRate: 16000 });
        const source = audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
        micProcessor = audioCtx.createScriptProcessor(4096, 1, 1);

        micProcessor.onaudioprocess = (e) => {
          if (deepgramWs.readyState !== WebSocket.OPEN) return;
          const floatSamples = e.inputBuffer.getChannelData(0);
          const int16 = floatTo16BitPCM(floatSamples);
          deepgramWs.send(int16);
        };

        source.connect(micProcessor);
        micProcessor.connect(audioCtx.destination);
      };

      deepgramWs.onmessage = (event) => {
        const res = JSON.parse(event.data);
        const result = res.channel?.alternatives?.[0];
        if (!result) return;

        const text = result.transcript?.trim() ?? "";
        if (!text) return;

        if (res.is_final) {
          sendText(text);
          setState((s) => ({ ...s, interim: "", final: s.final + " " + text }));
        } else {
          setState((s) => ({ ...s, interim: text }));
        }
      };

      deepgramWs.onerror = (err) => {
        console.error("[STT] Deepgram WS error:", err);
      };

      deepgramWs.onclose = () => {
        console.log("[STT] Deepgram closed");
        micTrack.stop();
        if (micProcessor) micProcessor.disconnect();
        if (audioCtx) audioCtx.close();
        // Auto-restart if still connected and room is alive
        if (isListeningRef.current && roomRef.current?.state === "connected") {
          setTimeout(() => start(), 300);
        }
      };

      // Heartbeat to keep alive
      const heartbeat = setInterval(() => {
        if (deepgramWs.readyState === WebSocket.OPEN) {
          deepgramWs.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 3000);

      // Cleanup on stop or room disconnect
      const cleanup = () => {
        clearInterval(heartbeat);
        if (deepgramWs.readyState === WebSocket.OPEN || deepgramWs.readyState === WebSocket.CONNECTING) {
          deepgramWs.send(JSON.stringify({ type: "CloseStream" }));
          deepgramWs.close();
        }
      };

      (window as any).__sttCleanup = cleanup;

      deepgramWs.addEventListener("close", () => {
        if ((window as any).__sttCleanup === cleanup) {
          delete (window as any).__sttCleanup;
        }
      });
    } catch (err) {
      console.error("[STT] Failed to start:", err);
      isListeningRef.current = false;
      setState({ isListening: false, interim: "", final: "" });
    }
  }, [sendText]);

  useEffect(() => {
    return () => {
      isListeningRef.current = false;
      const cleanup = (window as any).__sttCleanup;
      if (cleanup) cleanup();
    };
  }, []);

  // Auto-start when room connects
  useEffect(() => {
    if (room && room.state === "connected" && !isListeningRef.current) {
      start();
    }
  }, [room, start]);

  return { start, stop, ...state };
}

/** Convert Float32Array (-1..1) to Int16Array little-endian */
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output.buffer;
}
