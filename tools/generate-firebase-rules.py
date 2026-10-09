"""Generate readable, checked-in RTDB rules; emulator tests exercise the result."""
import json
from pathlib import Path
ID = "{v}.matches(/^[a-f0-9]{{32}}$/)"
valid_id=lambda v:ID.format(v=v)
def leaf(rule):return {'.validate':rule}
def obj(required, fields, extra='true'):
    return {'.validate':"newData.hasChildren("+json.dumps(required)+") && newData.getPriority() == null && ("+extra+")",**fields,'$other':{'.validate':False}}
ADMIN = "(auth != null && auth.token.email == 'mike.coward@gmail.com' && auth.token.email_verified == true && auth.token.firebase.sign_in_provider == 'google.com')"
ACTIVE = "root.child('bioglowV1/catalog').child($id).child('archived').val() != true"
meta=['revision','seq','name','updatedAt','uid','nickname']
fields={
 'revision':leaf("newData.isString() && "+valid_id('newData.val()')),
 'seq':leaf('newData.isNumber() && newData.val() >= 1 && newData.val() <= 1000000 && newData.val() % 1 == 0'),
 'name':leaf("newData.isString() && newData.val().matches(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/)"),
 'updatedAt':leaf('newData.isNumber() && newData.val() == now'),
 'uid':leaf('newData.isString() && newData.val() == auth.uid'),
 'archived':leaf('newData.isBoolean()'),
 'nickname':leaf("newData.isString() && newData.val().length <= 32 && newData.val().matches(/^[A-Za-z0-9 _-]*$/)")}
# newData.parent() navigates the proposed atomic multi-location write.
new_catalog="newData.parent().parent().parent().child('catalog').child($id)"
new_history="newData.parent().parent().child('history').child($id).child(newData.child('revision').val())"
old_catalog="root.child('bioglowV1/catalog').child($id)"
new_payload="newData.parent().parent().parent().child('payloads').child($id).child($rev)"
cat=obj(meta,fields, ' && '.join(new_history+f".child('{k}').val() == newData.child('{k}').val()" for k in meta+['archived']))
cat['.read']='auth != null'
# Only a verified Google owner can change the name or archive state. Student
# revisions must retain the name and target an active program. Legacy rows with
# no archived field are active, so no data migration is needed.
normal = "data.child('archived').val() != true && newData.child('archived').val() != true && newData.child('name').val() == data.child('name').val()"
cat['.write']="auth != null && newData.exists() && "+valid_id('$id')+" && ((!data.exists() && newData.child('seq').val() == 1 && newData.child('archived').val() != true) || (data.exists() && newData.child('seq').val() == data.child('seq').val() + 1 && (("+normal+") || "+ADMIN+")))"

history=obj(meta+['previous','restoredFrom'], {**fields,
 'previous':leaf("newData.isString() && ((!"+old_catalog+".exists() && newData.val() == '') || newData.val() == "+old_catalog+".child('revision').val())"),
 'restoredFrom':leaf("newData.isString() && (newData.val() == '' || ("+valid_id('newData.val()')+" && root.child('bioglowV1/history').child($id).child(newData.val()).exists()))")},
 "newData.child('revision').val() == $rev && "+new_payload+".exists() && "+' && '.join(new_catalog+f".child('{k}').val() == newData.child('{k}').val()" for k in meta+['archived']))
history['.read']='auth != null && ('+ACTIVE+' || '+ADMIN+')'
history['.write']='auth != null && !data.exists() && newData.exists() && '+valid_id('$id')+' && '+valid_id('$rev')
payload=obj(['version','workspace','start'],{
 'version':leaf('newData.isNumber() && newData.val() == 1'),
 'workspace':leaf('newData.isString() && newData.val().length > 0 && newData.val().length <= 131072'),
 'start':obj(['x','y','h'],{
 'x':leaf('newData.isNumber() && newData.val() >= 0 && newData.val() <= 2000'),
 'y':leaf('newData.isNumber() && newData.val() >= 0 && newData.val() <= 1143'),
 'h':leaf('newData.isNumber() && newData.val() >= -1000000 && newData.val() <= 1000000')})},
 new_catalog+".child('revision').val() == $rev && newData.parent().parent().parent().child('history').child($id).child($rev).exists()")
# Administrative metadata revisions must preserve raw workspace and pose. A
# simultaneous rename/archive cannot disguise a content edit, even by an admin.
old_payload="root.child('bioglowV1/payloads').child($id).child("+old_catalog+".child('revision').val())"
changed="("+old_catalog+".exists() && ("+new_catalog+".child('name').val() != "+old_catalog+".child('name').val() || ("+new_catalog+".child('archived').val() == true) != ("+old_catalog+".child('archived').val() == true)))"
preserve=' && '.join("newData.child('"+key+"').val() == "+old_payload+".child('"+key+"').val()" for key in ['version','workspace','start/x','start/y','start/h'])
payload['.validate'] += ' && (!'+changed+' || ('+ADMIN+' && '+preserve+'))'
payload['.read']='auth != null && ('+ACTIVE+' || '+ADMIN+')'
payload['.write']=history['.write']
rules={'rules':{'.read':False,'.write':False,'bioglowV1':{
 'adminAccess':{'.read':ADMIN,'.write':False},
 'catalog':{'.read':'auth != null && query.orderByKey == true && query.limitToFirst > 0 && query.limitToFirst <= 50','$id':cat},
 'history':{'$id':{'.indexOn':['seq'],'.read':"auth != null && ("+ACTIVE+" || "+ADMIN+") && query.orderByChild == 'seq' && query.limitToFirst > 0 && query.limitToFirst <= 20",'$rev':history}},
 'payloads':{'$id':{'$rev':payload}}
}}}
Path(__file__).resolve().parents[1].joinpath('firebase/database.rules.json').write_text(json.dumps(rules,indent=2)+'\n')
