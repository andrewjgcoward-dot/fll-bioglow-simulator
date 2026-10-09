// Separate named Firebase app/session: admin sign-in never replaces student auth.
import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,connectAuthEmulator,browserSessionPersistence,setPersistence} from 'firebase/auth';
export async function createAdminSession(config) {
  const auth=getAuth(initializeApp(config,'bioglow-admin'));
  if(config.authEmulator) {
    const url=new URL(config.authEmulator);
    if(!config.projectId.startsWith('demo-') || !['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Admin emulator requires a local demo project.');
    connectAuthEmulator(auth,url.href,{disableWarnings:true});
  }
  await setPersistence(auth,browserSessionPersistence);
  await auth.authStateReady();
  const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  return {
    signIn:()=>signInWithPopup(auth,provider),
    signOut:()=>signOut(auth),
    current:()=>auth.currentUser,
    session:async()=>{const user=auth.currentUser;if(!user)throw new Error('Sign in with the approved administrator Google account.');return {uid:user.uid,token:()=>user.getIdToken()};}
  };
}
