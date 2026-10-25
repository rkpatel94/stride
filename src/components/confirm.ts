import { Alert } from 'react-native';

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/** Native confirmation dialog. Resolves true only when the confirm button is pressed. */
export function confirm({ title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false }: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function showError(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  Alert.alert(title, message);
}
