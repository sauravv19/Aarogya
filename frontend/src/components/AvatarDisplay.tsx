"use client";

import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { cn } from "@/lib/utils";

interface AvatarDisplayProps {
  room: Room | null;
  agentState: string;
}

export default function AvatarDisplay({ room, agentState }: AvatarDisplayProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (!room || !videoRef.current) return;

    const videoEl = videoRef.current;

    const attachTrack = (track: any) => {
      if (track.kind === Track.Kind.Video) {
        track.attach(videoEl);
        setHasVideo(true);
      }
    };

    const detachTrack = (track: any) => {
      if (track.kind === Track.Kind.Video) {
        track.detach(videoEl);
        setHasVideo(false);
      }
    };

    // Listen for remote track subscription
    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.TrackUnsubscribed, detachTrack);

    // Catch tracks that were already subscribed before listener attached
    for (const [, participant] of room.remoteParticipants) {
      for (const [, pub] of participant.trackPublications) {
        if (pub.track && pub.kind === Track.Kind.Video) {
          attachTrack(pub.track);
        }
      }
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      room.off(RoomEvent.TrackUnsubscribed, detachTrack);
      if (videoEl) {
        videoEl.srcObject = null;
      }
      setHasVideo(false);
    };
  }, [room]);

  const isSpeaking = agentState === "speaking";
  const isConnecting = agentState === "connecting";

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black">
      {/* Real video element (always mounted so LiveKit can attach) */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn(
          "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
          hasVideo ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Placeholder when agent video not yet active */}
      {!hasVideo && (
        <div className="flex flex-col items-center gap-4 z-10">
          {isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[50%] h-[50%] rounded-3xl border-2 border-blue-400/25 animate-ring-pulse" />
              <div className="w-[50%] h-[50%] rounded-3xl border-2 border-blue-400/20 animate-ring-pulse-2" />
              <div className="w-[50%] h-[50%] rounded-3xl border-2 border-blue-400/15 animate-ring-pulse-3" />
            </div>
          )}

          <div className={cn(
            "text-[7rem] sm:text-[9rem] lg:text-[12rem] font-bold tracking-tighter leading-none select-none",
            isSpeaking ? "text-blue-400" : isConnecting ? "text-blue-300" : "text-slate-500"
          )}>
            A
          </div>
          <p className="text-base text-slate-400 font-medium tracking-wide">Aarogya</p>
        </div>
      )}

      {/* Speaking border ring */}
      {isSpeaking && hasVideo && (
        <div className="absolute inset-0 rounded-2xl ring-4 ring-blue-500/30 pointer-events-none z-20" />
      )}
    </div>
  );
}
