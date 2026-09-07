import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import RootNavigator from "./src/navigation/RootNavigator";
import { WalletProvider } from "./src/lib/WalletProvider";
import { SessionProvider } from "./src/lib/SessionContext";

export default function App() {
  return (
    <SafeAreaProvider>
      {/* WalletProvider must wrap SessionProvider — the session is keyed off
          whatever wallet address the wallet layer currently holds. */}
      <WalletProvider>
        <SessionProvider>
          <RootNavigator />
          <StatusBar style="light" />
        </SessionProvider>
      </WalletProvider>
    </SafeAreaProvider>
  );
}
