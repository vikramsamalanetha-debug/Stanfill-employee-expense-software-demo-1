// ============================================================
// Firebase configuration — REPLACE the values below with your
// own project's config from Firebase Console > Project settings
// > Your apps > (the web app) > SDK setup and configuration.
//
// This same file (and the same config) should be used on BOTH
// the customer-facing website and the owner's crew/bookkeeping
// portal, since they share one Firebase project and one
// "bookings" collection in Firestore.
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDYko5NB-FkjcBpc3fre-3oVbhiF6KKdiw",
  authDomain: "stanfill-clean-pros.firebaseapp.com",
  projectId: "stanfill-clean-pros",
  storageBucket: "stanfill-clean-pros.firebasestorage.app",
  messagingSenderId: "711004999611",
  appId: "1:711004999611:web:061f428e7d8e679e43be9e"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
