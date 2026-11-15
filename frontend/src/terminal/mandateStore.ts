import { create } from 'zustand';
import { defaultMandate, validMandate, type Mandate } from './portfolio';
import { readMandateDrafts, stashMandateDraft } from './mandateDrafts';
import { mandateKeys, mandateEntries, copyMandate, writeMandateCollection } from './mandateLibrary';
const blank=():Mandate=>({...defaultMandate,id:crypto.randomUUID(),name:'新策略'});
function load(){
 let library:Mandate[]=[],drafts:Mandate[]=[],selected='';
 try{library=readMandateDrafts(localStorage.getItem(mandateKeys.library),false);drafts=readMandateDrafts(localStorage.getItem(mandateKeys.drafts));selected=localStorage.getItem(mandateKeys.active)??'';}catch{/* The editor remains available without storage. */}
 return {library,drafts,draft:structuredClone(drafts.find(m=>m.id===selected)??library.find(m=>m.id===selected)??library[0]??drafts[0]??blank())};
}
type Removed={id:string;name:string;saved?:Mandate;draft?:Mandate;validDraft?:Mandate};
export const useMandates=create<{draft:Mandate;drafts:Mandate[];library:Mandate[];removed:Removed|null;error:string;deployment:Mandate|null;deploymentProfileId?:string}>(()=>({...load(),removed:null,error:'',deployment:null}));
export function selectMandate(value:Mandate){const s=useMandates.getState();useMandates.setState({draft:structuredClone(s.drafts.find(m=>m.id===value.id)??value),error:''});}
export function duplicateMandate(){try{
 const s=useMandates.getState();if(mandateEntries(s.library,s.drafts,s.draft).length>=20)throw new Error('最多 20 个策略，请先整理策略库');
 const draft=copyMandate(s.draft);useMandates.setState({draft,error:''});return draft;
}catch(e){useMandates.setState({error:e instanceof Error?e.message:'复制失败'});return null;}}
export function saveMandate(){try{
 const s=useMandates.getState(),draft=validMandate(s.draft);
 if(s.library.length>=20&&!s.library.some(m=>m.id===draft.id))throw new Error('最多 20 个策略，请先整理策略库');
 const library=[draft,...s.library.filter(m=>m.id!==draft.id)],drafts=stashMandateDraft(s.drafts,draft);
 writeMandateCollection(localStorage,library,drafts,draft.id);useMandates.setState({draft,library,drafts,error:''});return draft;
}catch(e){useMandates.setState({error:e instanceof Error?e.message:'策略保存失败'});return null;}}
export function removeMandate(){try{
 const s=useMandates.getState(),removed:Removed={id:s.draft.id,name:s.draft.name||'未命名策略',saved:s.library.find(m=>m.id===s.draft.id),draft:structuredClone(s.draft),validDraft:s.drafts.find(m=>m.id===s.draft.id)};
 const library=s.library.filter(m=>m.id!==removed.id),drafts=s.drafts.filter(m=>m.id!==removed.id),draft=structuredClone(mandateEntries(library,drafts)[0]??blank());
 writeMandateCollection(localStorage,library,drafts,draft.id);useMandates.setState({library,drafts,draft,removed,error:''});return true;
}catch(e){useMandates.setState({error:e instanceof Error?e.message:'删除失败'});return false;}}
export function undoMandateRemoval(){try{
 const s=useMandates.getState(),removed=s.removed;if(!removed)return false;
 if(s.library.some(m=>m.id===removed.id)||s.drafts.some(m=>m.id===removed.id))throw new Error('该策略已存在');
 if(mandateEntries(s.library,s.drafts).length>=20)throw new Error('策略库已满');
 const library=removed.saved?[removed.saved,...s.library]:s.library,draft=structuredClone(removed.draft??removed.saved!);let drafts:Mandate[];
 try{drafts=stashMandateDraft(s.drafts,draft);}catch{drafts=stashMandateDraft(s.drafts,removed.validDraft??removed.saved??{...blank(),id:removed.id});}
 writeMandateCollection(localStorage,library,drafts,draft.id);useMandates.setState({library,drafts,draft,removed:null,error:''});return true;
}catch(e){useMandates.setState({error:e instanceof Error?e.message:'恢复失败'});return false;}}
useMandates.subscribe((s,previous)=>{
 if(s.draft===previous.draft||s.library!==previous.library||s.removed!==previous.removed)return;
 let drafts:Mandate[];try{drafts=stashMandateDraft(s.drafts,s.draft);}catch{return;}
 useMandates.setState({drafts});
 try{localStorage.setItem(mandateKeys.drafts,JSON.stringify(drafts));localStorage.setItem(mandateKeys.active,s.draft.id);}catch{useMandates.setState({error:'草稿未能保存，请重试'});}
});
