"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Room } from "livekit-client";

interface BrowserSTTState {
  isListening: boolean;
  interim: string;
  final: string;
}

export function useBrowserSTT(room: Room | null) {
  const [state, setState] = useState<BrowserSTTState>({
    isListening: false,
    interim: "",
    final: "",
  });

  const recRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const roomRef = useRef(room);
  roomRef.current = room;

  const sendText = useCallback((text: string) => {
    const r = roomRef.current;
    if (!r || !text.trim()) return;
    try {
      r.localParticipant.publishData(
        new TextEncoder().encode(
          JSON.stringify({ channel: "text_input", text: text.trim() })
        ),
        { reliable: true }
      );
    } catch (e) {
      console.error("[BrowserSTT] Failed to publish:", e);
    }
  }, []);

  const start = useCallback(() => {
    if (isListeningRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error("[BrowserSTT] Web Speech API not supported");
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      isListeningRef.current = true;
      setState({ isListening: true, interim: "", final: "" });
    };

    rec.onend = () => {
      isListeningRef.current = false;
      setState((s) => ({ ...s, isListening: false }));
      // Auto-restart if the room is still connected
      if (roomRef.current?.state === "connected") {
        setTimeout(() => {
          if (!isListeningRef.current) start();
        }, 300);
      }
    };

    rec.onerror = (e: any) => {
      console.error("[BrowserSTT] error:", e.error);
      isListeningRef.current = false;
      setState((s) => ({ ...s, isListening: false }));
    };

    rec.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          final += text + " ";
          sendText(text);
        } else {
          interim += text + " ";
        }
      }

      setState((s) => ({
        interim: interim.trim(),
        final: s.final + (final ? " " + final.trim() : ""),
        isListening: true,
      }));
    };

    recRef.current = rec;
    rec.start();
  }, [sendText]);

  const stop = useCallback(() => {
    isListeningRef.current = false;
    recRef.current?.stop();
    recRef.current = null;
    setState({ isListening: false, interim: "", final: "" });
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  // Auto-start when room connects
  useEffect(() => {
    if (room && room.state === "connected" && !isListeningRef.current) {
      start();
    }
  }, [room, start]);

  return { start, stop, ...state };
}
