import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from './src/store/authStore';
import { AuthScreen } from './src/screens/AuthScreen';
import { MainTabNavigator } from './src/navigation/MainTabNavigator';
import { GameScreen } from './src/screens/GameScreen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, StyleSheet } from 'react-native';
import { api } from './src/api/client';

const Stack = createNativeStackNavigator();

export default function App() {
  const { isAuthenticated, initialize } = useAuthStore();

  useEffect(() => {
    const init = async () => {
      await initialize();
      const { token, logout, setUserAndStats } = useAuthStore.getState();
      if (!token) return;

      // 缓存的登录态需要向服务器校验：token 过期则自动登出，
      // 有效则顺手刷新用户信息与战绩；网络不通时保持现状不打断使用。
      try {
        const data = (await api.verifyToken()) as any;
        if (data?.user && data?.stats) {
          setUserAndStats(
            { ...data.user, avatar: data.user.avatar ?? undefined },
            data.stats
          );
        }
      } catch (err: any) {
        if (err?.status === 401) {
          console.warn('[App] 登录已过期，自动登出');
          await logout();
        }
      }
    };
    init();
  }, []);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {!isAuthenticated ? (
              <Stack.Screen name="Auth" component={AuthScreen} />
            ) : (
              <>
                <Stack.Screen name="Main" component={MainTabNavigator} />
                <Stack.Screen
                  name="Game"
                  component={GameScreen}
                  options={{
                    animation: 'slide_from_right',
                    gestureEnabled: false,
                  }}
                />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
