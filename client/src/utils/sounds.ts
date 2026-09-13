/**
 * 音效管理：expo-av 播放内置 WAV，AsyncStorage 持久化静音开关
 */
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SoundName = 'choice' | 'win' | 'lose' | 'draw' | 'game-win' | 'game-lose';

const SOUND_FILES: Record<SoundName, number> = {
  choice: require('../../assets/sounds/choice.wav'),
  win: require('../../assets/sounds/win.wav'),
  lose: require('../../assets/sounds/lose.wav'),
  draw: require('../../assets/sounds/draw.wav'),
  'game-win': require('../../assets/sounds/game-win.wav'),
  'game-lose': require('../../assets/sounds/game-lose.wav'),
};

const MUTE_KEY = '@maozi/sound-muted';

const loaded: Partial<Record<SoundName, Audio.Sound>> = {};
let muted: boolean | null = null; // null = 尚未从存储读取

export async function initSoundSettings(): Promise<void> {
  try {
    const value = await AsyncStorage.getItem(MUTE_KEY);
    muted = value === 'true';
  } catch {
    muted = false;
  }
}

export function isSoundMuted(): boolean {
  return muted === true;
}

export async function setSoundMuted(value: boolean): Promise<void> {
  muted = value;
  try {
    await AsyncStorage.setItem(MUTE_KEY, String(value));
  } catch {
    // 存储失败不阻塞开关
  }
  if (value) await unloadAll();
}

async function getSound(name: SoundName): Promise<Audio.Sound | null> {
  if (muted === null) await initSoundSettings();
  if (muted) return null;
  if (loaded[name]) return loaded[name]!;
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(SOUND_FILES[name]);
    loaded[name] = sound;
    return sound;
  } catch {
    return null;
  }
}

/** 播放音效；任何失败都静默忽略，不影响游戏流程 */
export async function playSound(name: SoundName): Promise<void> {
  try {
    const sound = await getSound(name);
    if (!sound) return;
    await sound.replayAsync();
  } catch {
    // 忽略播放失败（如资源未就绪、设备不支持）
  }
}

export async function unloadAll(): Promise<void> {
  for (const name of Object.keys(loaded) as SoundName[]) {
    const sound = loaded[name];
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // ignore
      }
    }
    delete loaded[name];
  }
}
