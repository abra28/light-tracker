import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCIM-ByEPVxvXxDtRJdZnb27f_1EBnQQEY",
  authDomain: "nepa-battle-tracker.firebaseapp.com",
  databaseURL: "https://nepa-battle-tracker-default-rtdb.firebaseio.com",
  projectId: "nepa-battle-tracker",
  storageBucket: "nepa-battle-tracker.firebasestorage.app",
  messagingSenderId: "626074377596",
  appId: "1:626074377596:web:ab2d6ccf028ac0939698f9"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
