// Built into vendor/firebase-auth.js by tools/build-firebase.mjs.
import {initializeApp} from 'firebase/app';
import {getAuth, signInAnonymously, connectAuthEmulator, browserLocalPersistence, setPersistence} from 'firebase/auth';
export async function anonymousSession(config, emulator) {
  const app=initializeApp(config, 'bioglow-shared-library');
  const auth=getAuth(app);
  if(emulator) connectAuthEmulator(auth,emulator,{disableWarnings:true});
  await setPersistence(auth,browserLocalPersistence);
  await auth.authStateReady();
  const user=auth.currentUser || (await signInAnonymously(auth)).user;
  return {uid:user.uid, token:()=>user.getIdToken()};
}
