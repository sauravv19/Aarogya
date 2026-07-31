"use client";

import { Activity, Mic, Shield, CalendarCheck, Clock, ChevronDown, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

/* ── Subtle floating ambient orbs ────────────────────────────── */
function AmbientOrbs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-blue-600/10 blur-[120px] animate-orb-float-1" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[45vw] h-[45vw] rounded-full bg-blue-800/10 blur-[120px] animate-orb-float-2" />
      <div className="absolute top-[30%] right-[20%] w-[30vw] h-[30vw] rounded-full bg-indigo-500/8 blur-[100px] animate-orb-float-3" />
    </div>
  );
}

/* ── Mesh grid overlay ───────────────────────────────────────── */
function MeshGrid() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.04]"
      style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0)`,
        backgroundSize: '40px 40px'
      }}
    />
  );
}

/* ── Breathing Avatar ───────────────────────────────────────── */
function BreathingAvatar() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer rings */}
      <div className="absolute w-[180px] h-[180px] rounded-full border border-blue-500/20 animate-breathe-ring" />
      <div className="absolute w-[180px] h-[180px] rounded-full border border-blue-400/10 animate-breathe-ring-2" />
      <div className="absolute w-[220px] h-[220px] rounded-full border border-blue-300/5 animate-breathe-ring-3" />
      
      {/* Glow */}
      <div className="absolute w-[140px] h-[140px] rounded-full bg-blue-500/20 blur-2xl animate-pulse" />
      
      {/* Center circle with A */}
      <div className="relative w-[120px] h-[120px] rounded-2xl bg-gradient-to-br from-blue-500/30 to-blue-700/20 border border-blue-400/30 flex items-center justify-center shadow-2xl shadow-blue-900/40 backdrop-blur-sm">
        <span className="text-5xl font-bold text-blue-300">A</span>
      </div>
    </div>
  );
}

/* ── Animated typing preview row ─────────────────────────────── */
function ConversationPreview() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 800),
      setTimeout(() => setStep(2), 2200),
      setTimeout(() => setStep(3), 4200),
      setTimeout(() => setStep(0), 7000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="w-full max-w-md mx-auto mt-8 space-y-2.5 opacity-80">
      {/* user bubble */}
      <div className={cn(
        "flex items-end gap-2 transition-all duration-700 transform",
        step >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}>
        <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-slate-300">U</span>
        </div>
        <div className="bg-slate-800/80 border border-white/[0.04] px-4 py-2 rounded-2xl rounded-bl-md text-sm text-slate-200">
          Hi, I need to book an appointment for tomorrow
        </div>
      </div>

      {/* agent bubble */}
      <div className={cn(
        "flex items-end gap-2 flex-row-reverse transition-all duration-700 transform",
        step >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}>
        <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-400/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-blue-300">A</span>
        </div>
        <div className="bg-blue-600/10 border border-blue-500/10 px-4 py-2 rounded-2xl rounded-br-md text-sm text-blue-100/90">
          Sure! Could you share your phone number so I can look you up?
        </div>
      </div>

      {/* tool toast */}
      <div className={cn(
        "flex justify-center transition-all duration-500",
        step >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      )}>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 rounded-full">
          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
          Identifying user
        </span>
      </div>
    </div>
  );
}

/* ── Feature pill ──────────────────────────────────────────────── */
function FeaturePill({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/[0.06] rounded-full px-3.5 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05] transition-colors">
      <Icon className="w-3.5 h-3.5 text-blue-400" />
      {label}
    </div>
  );
}

/* ── Step card ───────────────────────────────────────────────── */
function StepCard({ number, title, desc, delay }: { number: string; title: string; desc: string; delay: number }) {
  return (
    <div
      className="animate-fade-up opacity-0"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'forwards', animationDuration: '600ms' }}
    >
      <div className="flex items-start gap-4">
        <div className="w-8 h-8 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
          <span className="text-sm font-bold text-blue-400">{number}</span>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */
export default function WelcomeScreen({
  onConnect,
  error,
}: {
  onConnect: () => void;
  error: string | null;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(true);
  }, []);

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-slate-950 text-white">
      <AmbientOrbs />
      <MeshGrid />

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </div>
          <span className="text-sm font-semibold">Mykare Health</span>
        </div>
        <div className="text-[10px] font-medium text-slate-500 border border-white/[0.06] rounded-full px-3 py-1 bg-white/[0.02]">
          AI Voice Assistant
        </div>
      </nav>

      {/* ── Hero Section ───────────────────────────────────────── */}
      <section className={cn(
        "relative z-10 flex flex-col items-center justify-center px-6 pt-6 pb-10 transition-all duration-1000 mt-48",
        loaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      )}>
        <BreathingAvatar />

        <h1 className="mt-8 text-3xl sm:text-4xl lg:text-5xl font-bold text-center tracking-tight">
          Meet <span className="text-blue-400">Aarogya</span>
        </h1>
        <p className="mt-3 text-base sm:text-lg text-slate-400 text-center max-w-lg leading-relaxed">
          Your AI healthcare assistant. Book, modify, or cancel appointments — all through natural voice conversation.
        </p>

        {/* Feature pills */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          <FeaturePill icon={CalendarCheck} label="Book appointments" />
          <FeaturePill icon={Mic} label="Voice-first interface" />
          <FeaturePill icon={Shield} label="Secure &amp; private" />
        </div>

        {/* CTA */}
        <button
          onClick={onConnect}
          className={cn(
            "mt-8 group relative inline-flex items-center gap-2.5 px-10 py-3.5 rounded-full font-semibold text-lg text-white transition-all duration-300",
            "bg-blue-600 hover:bg-blue-500 hover:scale-105 active:scale-100 shadow-xl shadow-blue-900/25",
            "overflow-hidden"
          )}
        >
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
          <Phone className="w-5 h-5 relative z-10" />
          <span className="relative z-10">Start Call</span>
        </button>

        {/* Trust row */}
        <div className="mt-5 flex items-center gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400" /> No app install
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-blue-400" /> Works in browser
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-purple-400" /> End-to-end encrypted
          </span>
        </div>

        {error && (
          <p className="mt-4 text-red-400 text-sm bg-red-500/10 border border-red-500/15 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        {/* Animated conversation preview */}
        <ConversationPreview />

        {/* Scroll indicator */}
        {/* <div className="mt-10 flex flex-col items-center gap-1 text-slate-600 animate-bounce-slow">
          <span className="text-[10px] uppercase tracking-widest">How it works</span>
          <ChevronDown className="w-4 h-4" />
        </div> */}
      </section>

      {/* ── How it works ────────────────────────────────────────── */}
      {/* <section className="relative z-10 max-w-lg mx-auto px-6 pb-20 pt-6">
        <div className="rounded-2xl border border-white/[0.04] bg-white/[0.015] backdrop-blur-sm p-6 space-y-5">
          <h3 className="text-sm font-semibold text-slate-300 text-center uppercase tracking-wider">
            How it works
          </h3>
          <StepCard
            number="1"
            title="Start a voice call"
            desc="Click the button above and speak naturally with Aarogya. No forms, no typing."
            delay={100}
          />
          <StepCard
            number="2"
            title="Tell Aarogya what you need"
            desc="Book, reschedule, or cancel appointments. The AI understands your intent automatically."
            delay={250}
          />
          <StepCard
            number="3"
            title="Done in under 2 minutes"
            desc="Receive a summary of your conversation and appointment details instantly."
            delay={400}
          />
        </div>
      </section> */}

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="relative z-10 py-6 text-center text-[10px] text-slate-600 border-t border-white/[0.04]">
        Mykare Health — AI Voice Engineer Assignment · Built for demo purposes
      </footer>
    </div>
  );
}
