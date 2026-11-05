import React, { useState } from 'react';
import { getSubjectChoices, getSubjectCPAvailability, subjectCPLabel, resolveSelectionSubject, subjectValueForSelection, type SubjectSelectionContext } from '../services/subjectSelection';

interface Props extends SubjectSelectionContext {id:string;value:string;onChange:(value:string)=>void;required?:boolean;className?:string}
export const SubjectSelect: React.FC<Props> = ({id,value,onChange,required,className,...context}:Props) => {
  const [manual,setManual]=useState(false);
  const options=getSubjectChoices(context);
  const current=resolveSelectionSubject(value);
  const compatible=current&&options.some(s=>s.code===current.code);
  const retained=Boolean(value&&!compatible);
  const availability=getSubjectCPAvailability(value,context);
  return <div className="space-y-1.5">
    <select id={id} aria-label="Mata pelajaran" required={required} className={className}
      value={manual?'__custom__':compatible?current!.code:retained?'__retained__':''}
      onChange={e=>{if(e.target.value==='__custom__'){setManual(true);return;}setManual(false);if(e.target.value!=='__retained__')onChange(subjectValueForSelection(value,e.target.value));}}>
      <option value="">— Pilih Mata Pelajaran —</option>
      {retained&&<option value="__retained__">{value} — nilai saat ini</option>}
      {options.map(s=>{
        const cp=getSubjectCPAvailability(s.code,context);
        const label=cp.status==='RESOLVED'?'CP tersedia'+(cp.sources.some(source=>source.verificationStatus==='UNVERIFIED')?' / REVIEW':'')
          :cp.status==='NOT_APPLICABLE'?'KI/KD':cp.status==='UNRESOLVED'?'UNRESOLVED — CP manual':cp.status==='AMBIGUOUS'?'AMBIGUOUS — tinjau sumber / CP manual':'katalog — cek kelas/tahun';
        return <option key={s.code} value={s.code}>{s.name} — {label}</option>;
      })}
      <option value="__custom__">Mapel khusus / muatan lokal / lainnya…</option>
    </select>
    {compatible&&value!==current!.name&&<p className="text-xs text-slate-500">Nilai tersimpan: {value}</p>}
    {retained&&<p role="status" className="text-xs text-amber-800">{current?'Mapel saat ini tidak tercantum untuk konteks kelas/tahun/sumber ini. Tinjau pilihan sebelum menyimpan; nilainya tetap dipertahankan.':'Mapel khusus atau nama lama tetap dipertahankan. Pilih opsi lainnya untuk mengedit.'}</p>}
    {(value||availability.status==='PENDING'||availability.status==='NOT_APPLICABLE'||!options.length)&&
      <p role="status" className="text-xs text-slate-500">{subjectCPLabel(availability)}</p>}
    {manual&&<input id={`${id}-custom`} aria-label="Nama mapel khusus / muatan lokal" type="text" required={required} maxLength={160}
      value={value} onChange={e=>onChange(e.target.value)} pattern=".*\S.*" placeholder="Nama mapel khusus / muatan lokal" className={className}/>}
    {(manual||retained||!options.length)&&<p className="text-xs text-slate-500">{context.curriculum==='K13'?'Lengkapi KI/KD pada langkah berikutnya.':'Jalur CP manual: di Step 3 isi/salin teks CP, tambahkan elemen dan cantumkan sumber, lalu simpan secara eksplisit.'}</p>}
  </div>;
};
