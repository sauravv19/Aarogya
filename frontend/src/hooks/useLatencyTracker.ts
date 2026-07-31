"use client";

import { useState, useEffect, useCallback } from "react";
import { RoomEvent } from "livekit-client";

export interface LatencyReport {
  turn: number;
  perceived_ms: number;
}

export function useLatencyTracker(room: any) {
  const [latest, setLatest] = useState<LatencyReport | null>(null);

  const handleMessage = useCallback((payload: Uint8Array) => {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);
      if (data.channel === "latency") {
        setLatest({
          turn: data.turn,
          perceived_ms: data.perceived_ms,
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!room) return;
    room.on(RoomEvent.DataReceived, handleMessage);
    return () => {
      room.off(RoomEvent.DataReceived, handleMessage);
    };
  }, [room, handleMessage]);

  return { latest };
}
