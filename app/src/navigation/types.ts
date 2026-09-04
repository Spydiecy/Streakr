import type { Direction, Symbol_, WindowLength } from "../lib/types";

export type RootStackParamList = {
  Onboarding: undefined;
  RoomList: undefined;
  Room: { roomId: string };
  CallConfirm: {
    roomId: string;
    symbol: Symbol_;
    window: WindowLength;
    direction: Direction;
    stakeUsdso: number;
  };
  Result: { callId: string; roomId: string };
  Profile: undefined;
  GlobalLeaderboard: undefined;
};
