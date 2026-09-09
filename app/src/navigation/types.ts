import type { Direction, Symbol_, WindowLength } from "../lib/types";

export type RootStackParamList = {
  Onboarding: undefined;
  RoomList: undefined;
  Room: { roomId: string };
  // No CallConfirm route: confirming a call is a sheet over the room
  // (components/CallSheet.tsx), not a screen. Pushing a screen meant leaving the
  // room — and losing sight of the countdown and the book — to answer one
  // question about a market that expires in minutes.
  Result: { callId: string; roomId: string };
  Profile: undefined;
  GlobalLeaderboard: undefined;
};
