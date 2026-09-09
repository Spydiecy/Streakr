import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import RootNavigator from "./src/navigation/RootNavigator";
import { WalletProvider } from "./src/lib/WalletProvider";
import { SessionProvider } from "./src/lib/SessionContext";
import { ConnectivityBanner } from "./src/components/ui/ConnectivityBanner";

export default function App() {
  return (
    <SafeAreaProvider>
      {/* WalletProvider must wrap SessionProvider — the session is keyed off
          whatever wallet address the wallet layer currently holds. */}
      <WalletProvider>
        <SessionProvider>
          <View style={{ flex: 1 }}>
            <RootNavigator />
            {/* Sits outside the navigator so a blocked database is stated once,
                on every screen, rather than per-screen or not at all. */}
            <ConnectivityBanner />
          </View>
          <StatusBar style="light" />
        </SessionProvider>
      </WalletProvider>
    </SafeAreaProvider>
  );
}
