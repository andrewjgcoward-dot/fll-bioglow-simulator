import {firebaseConfig} from './firebase-config.js';
import {adminEnabled} from './admin-config.js';
import {firebaseTransport} from './shared-library.js';
import {createAdminLibrary} from './admin-library.js';
import {setupAdminUI} from './admin-ui.js';
const status=document.getElementById('admin-status');
if(!adminEnabled)status.textContent='Admin setup is pending approval. No sign-in or library changes are enabled.';
else {
  try {
    const {createAdminSession}=await import('../vendor/firebase-admin-auth.js');
    const auth=await createAdminSession(firebaseConfig);
    const request=firebaseTransport({databaseURL:firebaseConfig.databaseURL,session:auth.session,...(firebaseConfig.projectId.startsWith('demo-')?{namespace:firebaseConfig.projectId}:{})});
    setupAdminUI({document,auth,api:createAdminLibrary({request,session:auth.session})});
  }catch(e){status.textContent='Admin unavailable: '+e.message;}
}
