"use client";

import { useState, useEffect, useCallback } from "react";
import { RoomEvent } from "livekit-client";

export interface ToolCallEvent {
  tool: string;
  status: "started" | "completed" | "error" | "pending_name";
  data?: Record<string, unknown>;
  error?: string;
  timestamp: number;
}

export function useToolCalls(room: any) {
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);

  const handleMessage = useCallback((payload: Uint8Array, participant?: any) => {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);

      if (data.channel === "tool_call") {
        const event: ToolCallEvent = {
          tool: data.tool,
          status: data.status,
          data: data.data,
          timestamp: Date.now(),
        };
        setToolCalls((prev) => {
          // Update existing event if same tool, else add new
          const existing = prev.findIndex(
            (e) => e.tool === event.tool && e.status === "started"
          );
          if (existing !== -1 && event.status === "completed") {
            const updated = [...prev];
            updated[existing] = { ...updated[existing], ...event };
            return updated;
          }
          return [...prev.slice(-9), event]; // Keep last 10
        });
      }
    } catch {
      // Not a JSON message from our agent
    }
  }, []);

  useEffect(() => {
    if (!room) return;

    room.on(RoomEvent.DataReceived, handleMessage);
    return () => {
      room.off(RoomEvent.DataReceived, handleMessage);
    };
  }, [room, handleMessage]);

  return toolCalls;
}