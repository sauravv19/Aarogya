"use client";

import { useState, useEffect, useCallback } from "react";
import { RoomEvent } from "livekit-client";

export interface CostBreakdownItem {
  label: string;
  cost_usd: number;
  unit: string;
  rate: string;
  color: string;
}

export interface CostReport {
  duration_seconds: number;
  duration_formatted: string;
  turn_count: number;
  total_usd: number;
  total_inr: number;
  breakdown: Record<string, CostBreakdownItem>;
}

export interface CallSummary {
  summary: string;
  appointments: Array<{
    action: string;
    appointment: Record<string, unknown>;
  }>;
  user?: {
    id?: number;
    name?: string;
    phone?: string;
  } | null;
  user_preferences: string[];
  timestamp: string;
  cost?: CostReport | null;
}

export function useCallSummary(room: any) {
  const [summary, setSummary] = useState<CallSummary | null>(null);

  const handleMessage = useCallback((payload: Uint8Array) => {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);

      if (data.channel === "call_summary") {
        setSummary({
          summary: data.summary,
          appointments: data.appointments || [],
          user: data.user,
          user_preferences: data.user_preferences || [],
          timestamp: data.timestamp,
          cost: data.cost || null,
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

  return summary;
}
