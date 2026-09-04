import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import OnboardingScreen from "../screens/OnboardingScreen";
import RoomListScreen from "../screens/RoomListScreen";
import RoomScreen from "../screens/RoomScreen";
import CallConfirmScreen from "../screens/CallConfirmScreen";
import ResultScreen from "../screens/ResultScreen";
import ProfileScreen from "../screens/ProfileScreen";
import GlobalLeaderboardScreen from "../screens/GlobalLeaderboardScreen";
import { colors } from "../theme";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <NavigationContainer
      theme={{
        dark: true,
        colors: {
          primary: colors.primary,
          background: colors.bg,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.primary,
        },
        fonts: {
          regular: { fontFamily: "System", fontWeight: "400" },
          medium: { fontFamily: "System", fontWeight: "500" },
          bold: { fontFamily: "System", fontWeight: "700" },
          heavy: { fontFamily: "System", fontWeight: "900" },
        },
      }}
    >
      <Stack.Navigator
        initialRouteName="Onboarding"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade_from_bottom",
        }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ animation: "fade" }} />
        <Stack.Screen name="RoomList" component={RoomListScreen} options={{ animation: "fade" }} />
        <Stack.Screen name="Room" component={RoomScreen} />
        <Stack.Screen
          name="CallConfirm"
          component={CallConfirmScreen}
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="Result" component={ResultScreen} options={{ animation: "fade" }} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="GlobalLeaderboard" component={GlobalLeaderboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
