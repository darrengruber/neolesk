import * as Clipboard from 'expo-clipboard';

export const copyText = async (value: string): Promise<void> => {
    await Clipboard.setStringAsync(value);
};
