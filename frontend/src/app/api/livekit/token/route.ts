import { NextRequest, NextResponse } from "next/server";
import { AccessToken, AgentDispatchClient } from "livekit-server-sdk";

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "";
const API_KEY = process.env.LIVEKIT_API_KEY || "";
const API_SECRET = process.env.LIVEKIT_API_SECRET || "";

export async function POST(req: NextRequest) {
  try {
    const { roomName, participantName } = await req.json();

    if (!API_KEY || !API_SECRET) {
      return NextResponse.json(
        { error: "LiveKit credentials not configured" },
        { status: 500 }
      );
    }

    const room = roomName || "mykare";
    const identity = participantName || `patient-${Date.now()}`;

    // Generate participant token
    const token = new AccessToken(API_KEY, API_SECRET, { identity });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    // Dispatch the agent to the room
    try {
      const dispatchClient = new AgentDispatchClient(LIVEKIT_URL, API_KEY, API_SECRET);
      await dispatchClient.createDispatch(room, "healthcare-agent");
      console.log(`Agent dispatched to room: ${room}`);
    } catch (dispatchErr) {
      console.log("Agent dispatch note:", (dispatchErr as Error).message);
      // If dispatch fails, agent might auto-dispatch via Cloud config
    }

    return NextResponse.json({ token: jwt, url: LIVEKIT_URL });
  } catch (error) {
    console.error("Error generating LiveKit token:", error);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}