import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));

const adminApp = initializeApp({
  projectId: firebaseConfig.projectId,
});

const db = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);

async function test() {
  try {
    const snapshot = await db.collection('users').limit(1).get();
    console.log('Success:', snapshot.size);
  } catch (e) {
    console.error('Error:', e);
  }
}
test();
