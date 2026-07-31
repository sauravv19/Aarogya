"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, RemoteParticipant } from "livekit-client";
import { useToolCalls, ToolCallEvent } from "@/hooks/useToolCalls";
import { useCallSummary, CallSummary } from "@/hooks/useCallSummary";
import { useSTT } from "@/hooks/useSTT";
import { TOOL_LABELS } from "@/app-config";
import { cn, formatTime, formatDate } from "@/lib/utils";
import AvatarDisplay from "@/components/AvatarDisplay";
import WelcomeScreen from "@/components/WelcomeScreen";
import {
  PhoneOff,
  Mic,
  MicOff,
  Activity,
  CalendarCheck,
  UserSearch,
  Calendar,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Heart,
  Video,
  VideoOff,
  User,
  MessageSquare,
  X,
  DollarSign,
} from "lucide-react";

type AppState = "welcome" | "connecting" | "connected" | "summary";
type Appointment = {
  id: number;
  date: string;
  time: string;
  status: string;
  doctor_name?: string;
  department?: string;
  reason?: string;
};

/* ── Main Component ─────────────────────────────────────────────── */

export default function VoiceAgentApp() {
  const [appState, setAppState] = useState<AppState>("welcome");
  const [room, setRoom] = useState<Room | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [agentState, setAgentState] = useState<string>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);
  const [localSummary, setLocalSummary] = useState<CallSummary | null>(null);
  const [rightPanel, setRightPanel] = useState<"camera" | "transcript" | "appointments">("camera");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [callDuration, setCallDuration] = useState(0);

  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachedAudioElsRef = useRef<Array<{ track: any; el: HTMLAudioElement }>>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toolCalls = useToolCalls(room);
  const callSummary = useCallSummary(room);

  /* Agent audio track: attach to body when subscribed */
  useEffect(() => {
    if (!room) return;

    const attachAudio = (track: any, _pub: any, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio || participant.isLocal) return;
      const el = track.attach() as HTMLAudioElement;
      el.style.display = "none";
      document.body.appendChild(el);
      attachedAudioElsRef.current.push({ track, el });
    };

    const detachAudio = (track: any, _pub: any, participant: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio || participant.isLocal) return;
      const idx = attachedAudioElsRef.current.findIndex((a) => a.track === track);
      if (idx >= 0) {
        const { el } = attachedAudioElsRef.current[idx];
        try { el.pause(); el.srcObject = null; el.remove(); } catch {}
        attachedAudioElsRef.current.splice(idx, 1);
      }
    };

    room.on(RoomEvent.TrackSubscribed, attachAudio);
    room.on(RoomEvent.TrackUnsubscribed, detachAudio);

    // Catch tracks already subscribed before listener attached
    for (const [, participant] of room.remoteParticipants) {
      for (const [, pub] of participant.trackPublications) {
        if (pub.track && pub.kind === Track.Kind.Audio) {
          attachAudio(pub.track, pub, participant);
        }
      }
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachAudio);
      room.off(RoomEvent.TrackUnsubscribed, detachAudio);
    };
  }, [room]);

  /* Local video stream attachment — video element MUST be in DOM */
  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    if (localVideoStream) {
      video.srcObject = localVideoStream;
      video.play().catch(() => {});
    } else {
      video.pause();
      video.srcObject = null;
    }
  }, [localVideoStream]);

  /* Call duration timer */
  useEffect(() => {
    if (appState !== "connected") {
      setCallDuration(0);
      return;
    }
    const id = setInterval(() => setCallDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [appState]);

  /* Persist summary */
  useEffect(() => {
    if (callSummary) setLocalSummary(callSummary);
  }, [callSummary]);

  useEffect(() => {
    if (callSummary && appState === "connected") {
      setTimeout(() => setAppState("summary"), 500);
    }
  }, [callSummary, appState]);

  /* Cleanup */
  useEffect(() => {
    return () => {
      localVideoStream?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Helper: stop ringing audio ─────────────────────────────── */
  const stopRinging = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  /* ── Connect ─────────────────────────────────────────────────── */
  const connect = useCallback(async () => {
    try {
      setAppState("connecting");
      setAgentState("connecting");
      setError(null);

      /* Start ringing audio from user-gesture context */
      const audio = audioRef.current;
      if (audio) {
        audio.volume = 0.35;
        audio.currentTime = 0;
        await audio.play().catch(() => {});
      }

      const res = await fetch("/api/livekit/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: "mykare",
          participantName: `patient-${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      if (!res.ok) throw new Error("Failed to get connection token");
      const { token, url } = await res.json();

      const newRoom = new Room({
        publishDefaults: { videoSimulcastLayers: [] },
      });

      newRoom.on(RoomEvent.Connected, () => {
        stopRinging();
        setAgentState("listening");
      });

      newRoom.on(RoomEvent.Disconnected, () => {
        stopRinging();
      });

      newRoom.on(RoomEvent.DataReceived, (payload) => {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload));
          if (data.channel === "transcript") {
            setTranscript((prev) => [...prev, { role: data.role || "agent", text: data.text }]);
            if (data.role === "agent") {
              if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
              setAgentState("speaking");
              speakingTimeoutRef.current = setTimeout(() => setAgentState("listening"), 4000);
            }
          }
          if (data.channel === "tool_call") {
            if (data.status === "started") {
              if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
              setAgentState("thinking");
            } else if (data.status === "completed") {
              setAgentState("listening");
            }
            // Capture appointments data from retrieve_appointments or book_appointment
            if (
              data.tool === "retrieve_appointments" &&
              data.status === "completed" &&
              Array.isArray(data.data?.appointments)
            ) {
              setAppointments(data.data.appointments as Appointment[]);
            }
            if (
              data.tool === "book_appointment" &&
              data.status === "completed" &&
              data.data
            ) {
              setAppointments((prev) => {
                const exists = prev.find((a) => a.id === (data.data as any).id);
                if (exists) return prev;
                return [...prev, data.data as Appointment];
              });
            }
          }
        } catch {}
      });

      await newRoom.connect(url, token);
      // Note: we keep mic enabled for agent audio playback, but STT comes from browser Deepgram
      await newRoom.localParticipant.setMicrophoneEnabled(true);

      setRoom(newRoom);
      setAppState("connected");
      // Browser STT will auto-start via useEffect when room becomes non-null
    } catch (err: any) {
      stopRinging();
      setError(err.message || "Failed to connect");
      setAppState("welcome");
      setAgentState("disconnected");
    }
  }, []);

  /* ── Disconnect ───────────────────────────────────────────────── */
  const disconnect = useCallback(async () => {
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false);
      await room.disconnect();
      setRoom(null);
    }
    if (speakingTimeoutRef.current) clearTimeout(speakingTimeoutRef.current);
    // Remove & destroy all attached agent audio elements
    for (const { el } of attachedAudioElsRef.current) {
      try { el.pause(); el.srcObject = null; el.remove(); } catch {}
    }
    attachedAudioElsRef.current = [];
    localVideoStream?.getTracks().forEach((t) => t.stop());
    setLocalVideoStream(null);
    setIsCameraOn(false);
    stopRinging();
    setAgentState("disconnected");
    setAppState("welcome");
  }, [room, localVideoStream, stopRinging]);

  /* ── Mute ─────────────────────────────────────────────────────── */
  const toggleMute = useCallback(async () => {
    if (!room) return;
    const next = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setIsMuted(next);
  }, [room, isMuted]);

  /* ── Camera (local-only preview) ──────────────────────────────── */
  const toggleCamera = useCallback(async () => {
    if (!isCameraOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setLocalVideoStream(stream);
        setIsCameraOn(true);
      } catch (err) {
        console.error("Camera access denied:", err);
      }
    } else {
      localVideoStream?.getTracks().forEach((t) => t.stop());
      setLocalVideoStream(null);
      setIsCameraOn(false);
    }
  }, [isCameraOn, localVideoStream]);

  /* ── Derived ─────────────────────────────────────────────────── */
  const latestTools = useMemo(() => toolCalls.slice(-2), [toolCalls]);

  const statusText =
    agentState === "speaking"
      ? "Aarogya is speaking..."
      : agentState === "thinking"
        ? "Aarogya is thinking..."
        : isMuted
          ? "Your mic is muted"
          : "Listening...";

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <div className="h-screen bg-slate-950 text-white flex flex-col overflow-hidden">
      <audio ref={audioRef} src="/ringing.wav" preload="auto" />

      {/* ── Header ────────────────────────────────────────────── */}
      {/* <header className="shrink-0 h-12 px-5 flex items-center justify-between border-b border-white/[0.06] z-20 bg-slate-950/90 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Mykare Health</h1>
            <p className="text-[10px] text-slate-400 leading-tight">AI Voice Assistant</p>
          </div>
        </div>

        {appState === "connected" && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-300 tabular-nums font-mono">{formatDuration(callDuration)}</span>
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
          </div>
        )}
      </header> */}

      {/* ── Main ──────────────────────────────────────────────── */}
      <main className="relative flex-1 overflow-hidden">

        {/* Welcome */}
        {appState === "welcome" && <WelcomeScreen onConnect={connect} error={error} />}

        {/* Connecting / Ringing */}
        {appState === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-[80vw] max-w-3xl aspect-video rounded-2xl overflow-hidden border border-slate-700/40 shadow-2xl bg-black">
              <AvatarDisplay room={null} agentState="connecting" />
            </div>
            <p className="mt-6 text-lg font-medium text-slate-200">Calling Aarogya...</p>
            <p className="mt-1 text-sm text-slate-500">Please wait while we connect you</p>
          </div>
        )}

        {/* Connected — Split-screen layout */}
        {appState === "connected" && (
          <div className="absolute inset-0 flex">
            {/* LEFT: Agent (fills ~65% width) */}
            <div className="flex-1 relative bg-black">
              <AvatarDisplay room={room} agentState={agentState} />

              {/* Agent name badge */}
              <div className="absolute bottom-5 left-5 z-10 flex items-center gap-2 bg-black/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-full border border-white/[0.08] text-sm font-medium">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  agentState === "speaking" ? "bg-blue-400 animate-pulse" :
                  agentState === "thinking" ? "bg-amber-400 animate-pulse" :
                  "bg-emerald-400"
                )} />
                Aarogya
              </div>
            </div>

            {/* RIGHT: User + tools + transcript + controls */}
            <div className="w-[420px] max-w-[30vw] min-w-[320px] border-l border-white/[0.06] bg-slate-950/80 backdrop-blur-sm flex flex-col z-20">
              {/* Top bar */}
              <div className="shrink-0 h-12 px-4 flex items-center justify-between border-b border-white/[0.06]">
                <span className="text-sm font-medium text-slate-300">{statusText}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRightPanel((p) => p === "appointments" ? "camera" : "appointments")}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-all border text-xs",
                      rightPanel === "appointments"
                        ? "bg-emerald-600/90 border-emerald-500 text-white"
                        : "bg-slate-800/70 border-white/10 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    )}
                    title="Toggle appointments"
                  >
                    <CalendarCheck className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setRightPanel((p) => p === "transcript" ? "camera" : "transcript")}
                    className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center transition-all border text-xs",
                      rightPanel === "transcript"
                        ? "bg-blue-600/90 border-blue-500 text-white"
                        : "bg-slate-800/70 border-white/10 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                    )}
                    title="Toggle transcript"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Tool call toasts */}
              <div className="shrink-0 px-3 pt-3 space-y-2">
                {latestTools.map((tc, i) => (
                  <ToolCallToast key={`${tc.tool}-${tc.timestamp}-${i}`} event={tc} />
                ))}
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                {rightPanel === "appointments" ? (
                  <AppointmentsPanel appointments={appointments} />
                ) : rightPanel === "transcript" ? (
                  <div className="flex-1 overflow-y-auto p-4 space-y-3 animate-fade-in">
                    {transcript.length === 0 ? (
                      <p className="text-slate-500 text-sm italic text-center py-8">
                        Conversation will appear here...
                      </p>
                    ) : (
                      transcript.map((msg, i) => (
                        <div key={i} className="text-sm leading-relaxed">
                          <span className={cn(
                            "font-semibold text-[10px] uppercase tracking-wider",
                            msg.role === "user" ? "text-blue-400" : "text-emerald-400/70"
                          )}>
                            {msg.role === "user" ? "You" : "Aarogya"}
                          </span>
                          <p className={cn(
                            "mt-0.5",
                            msg.role === "user" ? "text-blue-100/90" : "text-slate-300"
                          )}>
                            {msg.text}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 animate-fade-in">
                    {/* User camera: video ALWAYS in DOM so ref works */}
                    <div className="w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-900 border border-white/[0.06] shadow-lg relative">
                      <video
                        ref={localVideoRef}
                        muted
                        autoPlay
                        playsInline
                        className={cn(
                          "absolute inset-0 w-full h-full object-cover transition-opacity duration-300",
                          isCameraOn ? "opacity-100 z-10" : "opacity-0 z-0"
                        )}
                      />

                      <div className={cn(
                        "absolute inset-0 flex flex-col items-center justify-center text-slate-500 transition-opacity duration-300",
                        isCameraOn ? "opacity-0 z-0" : "opacity-100 z-10"
                      )}>
                        <div className="w-20 h-20 rounded-full bg-slate-800 border border-white/[0.05] flex items-center justify-center mb-3">
                          <User className="w-9 h-9 text-slate-500" />
                        </div>
                        <span className="text-sm text-slate-400">Camera is off</span>
                        <span className="text-xs text-slate-600 mt-1">Turn on to show video</span>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">You</p>
                  </div>
                )}
              </div>

              {/* Bottom controls */}
              <div className="shrink-0 p-4 border-t border-white/[0.06]">
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={toggleMute}
                    className={cn(
                      "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200",
                      isMuted
                        ? "bg-red-500/90 text-white"
                        : "bg-slate-700/80 hover:bg-slate-600 text-white"
                    )}
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>

                  <button
                    onClick={toggleCamera}
                    className={cn(
                      "w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200",
                      isCameraOn
                        ? "bg-emerald-500/90 text-white"
                        : "bg-slate-700/80 hover:bg-slate-600 text-white"
                    )}
                    title={isCameraOn ? "Turn off camera" : "Turn on camera"}
                  >
                    {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  </button>

                  <button
                    onClick={disconnect}
                    className="w-14 h-11 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all duration-200 text-white"
                    title="End call"
                  >
                    <PhoneOff className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Summary */}
        {appState === "summary" && localSummary && (
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-950/80 backdrop-blur-md">
            <SummaryView
              summary={localSummary}
              onNewCall={() => {
                setAppState("welcome");
                setLocalSummary(null);
                setTranscript([]);
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function WelcomeView({ onConnect, error }: { onConnect: () => void; error: string | null }) {
  return (
    <div className="text-center max-w-sm">
      <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-900/20">
        <Activity className="w-10 h-10 text-blue-400" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Welcome to Mykare Health</h2>
      <p className="text-slate-400 mb-8 leading-relaxed">
        Your AI voice assistant for booking and managing healthcare appointments.
      </p>
      <button
        onClick={onConnect}
        className="px-10 py-3 bg-blue-600 hover:bg-blue-500 rounded-full font-semibold text-lg text-white transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/30"
      >
        Start Call
      </button>
      {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
    </div>
  );
}

function ToolCallCard({ event }: { event: ToolCallEvent }) {
  const config = TOOL_LABELS[event.tool] || { label: event.tool, icon: "Activity" };
  const isCompleted = event.status === "completed";
  const isPending = event.status === "started";
  const data = event.data as Record<string, string | number | undefined> | undefined;

  return (
    <div className={cn(
      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all",
      isCompleted ? "bg-green-500/8 border border-green-500/15" :
      isPending ? "bg-blue-500/8 border border-blue-500/15" :
      "bg-slate-800/40 border border-slate-700/40"
    )}>
      {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" /> :
       isPending ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" /> :
       <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
      <span className={cn(
        isCompleted ? "text-green-300" : isPending ? "text-blue-300" : "text-slate-400"
      )}>
        {config.label}
      </span>
      {isCompleted && data && (
        <span className="text-slate-500 text-[10px] truncate ml-auto">
          {event.tool === "book_appointment" && data.date && (
            <>{formatTime(String(data.time ?? ""))} on {String(data.date)}</>
          )}
          {event.tool === "identify_user" && data.name && <>{String(data.name)}</>}
          {event.tool === "fetch_slots" && data.count !== undefined && <>{Number(data.count)} slots</>}
        </span>
      )}
    </div>
  );
}

function ToolCallToast({ event }: { event: ToolCallEvent }) {
  const [visible, setVisible] = useState(true);
  const isCompleted = event.status === "completed";
  const config = TOOL_LABELS[event.tool] || { label: event.tool };

  useEffect(() => {
    if (isCompleted) {
      const t = setTimeout(() => setVisible(false), 2200);
      return () => clearTimeout(t);
    }
  }, [isCompleted]);

  if (!visible) return null;

  return (
    <div className={cn(
      "animate-toast-in flex items-center gap-2 pl-2.5 pr-3.5 py-1.5 rounded-full text-[11px] shadow-lg border backdrop-blur-md",
      isCompleted
        ? "bg-green-500/10 border-green-500/20 text-green-300"
        : "bg-blue-500/10 border-blue-500/20 text-blue-300"
    )}>
      {isCompleted ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
      ) : (
        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
      )}
      <span className="font-medium">{config.label}</span>
      {isCompleted && <span className="text-green-400/60 text-[10px] ml-0.5">Done</span>}
    </div>
  );
}

function AppointmentsPanel({ appointments }: { appointments: Appointment[] }) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 animate-fade-in">
      {appointments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Calendar className="w-8 h-8 text-slate-600 mb-2" />
          <p className="text-slate-500 text-sm">No appointments yet.</p>
          <p className="text-slate-600 text-xs mt-1">
            Ask Aarogya to book or check your appointments.
          </p>
        </div>
      ) : (
        appointments.map((appt) => (
          <div
            key={appt.id}
            className={cn(
              "rounded-xl border p-3 text-sm transition-all",
              appt.status === "cancelled"
                ? "bg-red-500/5 border-red-500/10 opacity-60"
                : "bg-slate-800/40 border-slate-700/40"
            )}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-slate-200">
                {formatDate(appt.date)}
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide",
                  appt.status === "booked"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border border-red-500/20"
                )}
              >
                {appt.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Clock className="w-3 h-3" />
              <span>{formatTime(appt.time)}</span>
              {appt.doctor_name && (
                <>
                  <span className="text-slate-600">•</span>
                  <User className="w-3 h-3" />
                  <span>{appt.doctor_name}</span>
                </>
              )}
            </div>
            {appt.reason && (
              <div className="mt-1 text-xs text-slate-500">
                Reason: {appt.reason}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function SummaryView({ summary, onNewCall }: { summary: CallSummary; onNewCall: () => void }) {
  const cost = summary.cost;

  const colorMap: Record<string, string> = {
    purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    pink: "bg-pink-500/10 text-pink-400 border-pink-500/20",
    green: "bg-green-500/10 text-green-400 border-green-500/20",
  };

  const barMap: Record<string, string> = {
    purple: "bg-purple-400",
    orange: "bg-orange-400",
    blue: "bg-blue-400",
    pink: "bg-pink-400",
    green: "bg-green-400",
  };

  return (
    <div className="max-w-md w-full text-center">
      <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-green-900/10">
        <CheckCircle2 className="w-8 h-8 text-green-400" />
      </div>
      <h2 className="text-xl font-bold mb-5">Call Summary</h2>

      <div className="bg-slate-800/40 rounded-2xl p-5 text-left space-y-4 mb-6 border border-white/[0.04]">
        {summary.user && (
          <div className="flex items-center gap-2.5">
            <UserSearch className="w-4 h-4 text-blue-400" />
            <span className="text-sm">Patient: {summary.user.name}</span>
          </div>
        )}

        <div className="flex items-start gap-2.5">
          <FileText className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <p className="text-sm text-slate-300 leading-relaxed">{summary.summary}</p>
        </div>

        {summary.appointments.length > 0 && (
          <div className="border-t border-slate-700/40 pt-3">
            <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
              <CalendarCheck className="w-4 h-4" /> Appointments
            </h4>
            {summary.appointments.map((appt, i) => {
              const appointment = (appt.appointment || appt) as any;
              return (
                <div key={i} className="rounded-lg bg-slate-900/40 border border-slate-700/30 p-2.5 mb-2 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-slate-200">
                      {appointment?.date ? formatDate(appointment.date) : "Appointment"}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {appointment?.status || "booked"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <Clock className="w-3 h-3" />
                    <span>{appointment?.time ? formatTime(String(appointment.time)) : "Time unknown"}</span>
                    {appointment?.doctor_name && (
                      <>
                        <span className="text-slate-600">•</span>
                        <User className="w-3 h-3" />
                        <span>{appointment.doctor_name}</span>
                      </>
                    )}
                  </div>
                  {appointment?.reason && (
                    <div className="mt-1 text-xs text-slate-500">Reason: {appointment.reason}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {summary.user_preferences && summary.user_preferences.length > 0 && (
          <div className="border-t border-slate-700/40 pt-3">
            <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
              <Heart className="w-4 h-4" /> Patient Preferences
            </h4>
            {summary.user_preferences.map((pref, i) => (
              <div key={i} className="flex items-center gap-2 text-sm mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                <span className="text-slate-300">{pref}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Cost Breakdown ─────────────────────────────────────── */}
        {cost && (
          <div className="border-t border-slate-700/40 pt-3">
            <h4 className="text-sm font-medium text-slate-400 mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Cost Breakdown
            </h4>

            <div className="rounded-xl bg-slate-900/50 border border-slate-700/30 p-4 space-y-3">
              {/* Total */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-700/30">
                <div className="text-left">
                  <div className="text-lg font-bold text-slate-100">
                    ${cost.total_usd.toFixed(3)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    ~₹{cost.total_inr.toFixed(2)} • {cost.duration_formatted} • {cost.turn_count} turns
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wide">Estimated</div>
                  <div className="text-[10px] text-slate-600">per call</div>
                </div>
              </div>

              {/* Service rows */}
              {Object.values(cost.breakdown).map((item: any, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full",
                          barMap[item.color] || "bg-slate-400"
                        )}
                      />
                      <span className="text-slate-300">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 text-[10px]">{item.unit}</span>
                      <span className={cn(
                        "text-[10px] font-semibold px-1.5 py-0.5 rounded border",
                        colorMap[item.color] || "bg-slate-500/10 text-slate-400 border-slate-500/20"
                      )}>
                        ${item.cost_usd.toFixed(3)}
                      </span>
                    </div>
                  </div>
                  {/* Mini bar */}
                  {cost.total_usd > 0 && (
                    <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", barMap[item.color] || "bg-slate-400")}
                        style={{ width: `${Math.max(1, (item.cost_usd / cost.total_usd) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-500 border-t border-slate-700/40 pt-3">
          <Clock className="w-3 h-3" />
          {new Date(summary.timestamp).toLocaleString()}
        </div>
      </div>

      <button
        onClick={onNewCall}
        className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-full font-medium transition-all hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/20 text-white"
      >
        New Call
      </button>
    </div>
  );
}
