import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDatabase } from '@/database/database';
import { notifyDataChanged } from '@/database/dataEvents';
import { writeTransaction } from '@/database/writeQueue';
import { localDayKey } from '@/utils/dates';

import { createBackup, importBackup, parseBackup, type ImportResult } from './backup';

/**
 * Writes a backup to the app cache and opens the Android share sheet so the user decides where
 * it goes (Files, a USB drive, their own cloud). Nothing is sent anywhere automatically.
 */
export async function exportBackupFile(): Promise<{ activities: number }> {
  const db = await getDatabase();
  const backup = await createBackup(db);
  const file = new File(Paths.cache, `stride-backup-${localDayKey(Date.now())}.json`);
  if (file.exists) file.delete();
  file.create();
  await file.write(JSON.stringify(backup));
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save Stride backup' });
  return { activities: backup.activities.length };
}

/** Lets the user pick a backup file and merges it. Returns null if the picker was cancelled. */
export async function importBackupFile(): Promise<ImportResult | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (picked.canceled || picked.assets.length === 0) return null;
  const text = await new File(picked.assets[0].uri).text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  const backup = parseBackup(json);
  const db = await getDatabase();
  let result: ImportResult = { imported: 0, skipped: 0, goals: 0 };
  await writeTransaction(db, async () => {
    result = await importBackup(db, backup);
  });
  notifyDataChanged();
  return result;
}
