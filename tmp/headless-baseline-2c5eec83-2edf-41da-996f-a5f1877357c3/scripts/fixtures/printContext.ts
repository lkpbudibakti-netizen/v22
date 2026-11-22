import type { DocumentGenerationContext } from '../../src/services/documentEngine/types';
const stamp = '2026-10-20T08:00:00Z';

export function createMockContext(opts?: {
  semester?: '1' | '2';
  schoolName?: string;
  teacherName?: string;
  principalName?: string;
  numAtpItems?: number;
}):DocumentGenerationContext {
  const sem = opts?.semester || '1';
  const year = sem === '1' ? 2026 : 2027;
  const month = sem === '1' ? '10' : '01';
  const itemCount = opts?.numAtpItems ?? 4;

  const tpItems = Array.from({ length: itemCount }, (_, i) => ({competence: 'Memahami',contentScope:'Informatika',
    id: `tp-${i + 1}`,
    code: `TP.${i + 1}`,
    statement: `Mampu memahami dan mempraktikkan konsep pembelajaran tahap ${i + 1}`,
    order: i + 1,
  }));

  const atpItems = Array.from({ length: itemCount }, (_, i) => ({
    id: `atp-${i + 1}`,
    stepNumber: i + 1,
    focus: `Fokus unit pembelajaran bertahap ${i + 1}`,
    linkedTpIds: [`tp-${i + 1}`],
    semester: (i < 2 ? 1 : 2) as 1|2,
    unitTitle: i < 2 ? 'Bab 1 Pembelajaran Terpadu' : 'Bab 2 Pembelajaran Lanjutan',
    jp: 3,
  }));

  const materials = tpItems.map((t, idx) => ({
    id: `mat-${idx + 1}`,
    title: `Materi Pokok ${idx + 1}`,
    order: idx + 1,
    linkedTpIds: [t.id],
    linkedAtpItemIds: [atpItems[idx].id],
  }));

  const units = [
    {
      id: 'unit-1',
      title: 'Bab 1 Pembelajaran Terpadu',
      order: 1,
      linkedTpIds: [tpItems[0].id, tpItems[1].id],
      linkedAtpItemIds: [atpItems[0].id, atpItems[1].id],
      materials: [materials[0], materials[1]],
    },
    {
      id: 'unit-2',
      title: 'Bab 2 Pembelajaran Lanjutan',
      order: 2,
      linkedTpIds: [tpItems[2].id, tpItems[3].id],
      linkedAtpItemIds: [atpItems[2].id, atpItems[3].id],
      materials: [materials[2], materials[3]],
    },
  ];

  const meetings = [
    {
      id: 'meet-1',
      title: 'Pertemuan 1',
      unitId: 'unit-1',
      order: 1,
      jp: 3,
      linkedTpIds: [tpItems[0].id],
      linkedAtpItemIds: [atpItems[0].id],
      materialIds: [materials[0].id],
    },
    {
      id: 'meet-2',
      title: 'Pertemuan 2',
      unitId: 'unit-1',
      order: 2,
      jp: 3,
      linkedTpIds: [tpItems[1].id],
      linkedAtpItemIds: [atpItems[1].id],
      materialIds: [materials[1].id],
    },
    {
      id: 'meet-3',
      title: 'Pertemuan 3',
      unitId: 'unit-2',
      order: 1,
      jp: 3,
      linkedTpIds: [tpItems[2].id],
      linkedAtpItemIds: [atpItems[2].id],
      materialIds: [materials[2].id],
    },
    {
      id: 'meet-4',
      title: 'Pertemuan 4',
      unitId: 'unit-2',
      order: 2,
      jp: 3,
      linkedTpIds: [tpItems[3].id],
      linkedAtpItemIds: [atpItems[3].id],
      materialIds: [materials[3].id],
    },
  ];

  const executionUnits = [
    { unitId: 'unit-1', meetings: [meetings[0], meetings[1]] },
    { unitId: 'unit-2', meetings: [meetings[2], meetings[3]] },
  ];

  const schedules:NonNullable<DocumentGenerationContext['learningMeetingSchedules']> = [
    {
      semesterPlanId: 'sem-1',
      semester: 1,
      schedule: {
        id:'fixture-schedule',unresolvedMeetingIds:[],basedOnMappingUpdatedAt:stamp,basedOnUnitExecutionPlanUpdatedAt:stamp,basedOnSubjectWeeklyScheduleUpdatedAt:stamp,basedOnCalendarUpdatedAt:stamp,basedOnWeeklyJP:3,updatedAt:stamp,
        semesterPlanId: 'sem-1',
        status: 'COMPLETE',
        entries: [
          {
            meetingId: 'meet-1',sessionId:'session-meet-1',sourceSlotId:'subject-slot:sem-1:session-meet-1:2026-10-12',
            semesterPlanId: 'sem-1',
            unitId: 'unit-1',
            date: '2026-10-12',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 1,
          },
          {
            meetingId: 'meet-2',sessionId:'session-meet-2',sourceSlotId:'subject-slot:sem-1:session-meet-2:2026-10-19',
            semesterPlanId: 'sem-1',
            unitId: 'unit-1',
            date: '2026-10-19',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 2,
          },
        ],
      },
    },
    {
      semesterPlanId: 'sem-2',
      semester: 2,
      schedule: {
        id:'fixture-schedule',unresolvedMeetingIds:[],basedOnMappingUpdatedAt:stamp,basedOnUnitExecutionPlanUpdatedAt:stamp,basedOnSubjectWeeklyScheduleUpdatedAt:stamp,basedOnCalendarUpdatedAt:stamp,basedOnWeeklyJP:3,updatedAt:stamp,
        semesterPlanId: 'sem-2',
        status: 'COMPLETE',
        entries: [
          {
            meetingId: 'meet-3',sessionId:'session-meet-3',sourceSlotId:'subject-slot:sem-2:session-meet-3:2027-01-11',
            semesterPlanId: 'sem-2',
            unitId: 'unit-2',
            date: '2027-01-11',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 1,
          },
          {
            meetingId: 'meet-4',sessionId:'session-meet-4',sourceSlotId:'subject-slot:sem-2:session-meet-4:2027-01-18',
            semesterPlanId: 'sem-2',
            unitId: 'unit-2',
            date: '2027-01-18',
            jp: 3,
            mode: 'MANUAL_OVERRIDE',
            dayOfWeek: 1,
            weekIndex: 2,
          },
        ],
      },
    },
  ];

  const calendarDays = Array.from({ length: 31 }, (_, i) => ({
    id: `d-${i + 1}`,
    academicCalendarId: `cal-${sem}`,
    date: `${year}-${month}-${String(i + 1).padStart(2, '0')}`,
    status: 'EFFECTIVE_LEARNING' as const,
  }));

  return {
    school: {
      id: 'school-1',
      name: opts?.schoolName || 'SMP Negeri 1 Pembelajaran',
      npsn: '20109988', village:'Desa',province:'Jawa Barat',createdAt:stamp,updatedAt:stamp,
      address: 'Jl. Merdeka Belajar No. 10',
      district: 'Kecamatan Cerdas',
      regency: 'Kabupaten Maju',
      principalName: opts?.principalName || 'Drs. H. Kepala Sekolah, M.Pd.',
      principalNip: '197001011995011001',
    },
    profile: {
      id: 'teacher-1',
      name: opts?.teacherName || 'Ibu Guru Hebat, S.Pd.',
      nip: '198502022010012002',status:'PNS',defaultSubject:'Informatika',defaultLevel:'SMP',schoolId:'school-1',createdAt:stamp,updatedAt:stamp,
    },
    academicSetting: {
      id: `sem-${sem}`,
      profileId: 'teacher-1',
      subject: 'Informatika',
      grade: 'Kelas 7',
      phase: 'D',
      semester: sem==='1'?'1 (Ganjil)':'2 (Genap)', updatedAt:stamp,
      academicYear: '2026/2027',
      curriculum: 'Kurikulum Merdeka',
      curriculumType: 'KURIKULUM_MERDEKA',
    },
    documentDate: `${year}-${month}-15`,
    skipDownload: true,
    documentMode: 'data' as const,
    cp: {
      id: `cp-${sem}`,
      academicSettingId: `sem-${sem}`,
      generalDescription: 'Capaian Pembelajaran Informatika Fase D secara menyeluruh.',
      elements: [
        {
          id: 'elem-1',
          name: 'Berpikir Komputasional',
          content: 'Peserta didik mampu menerapkan berpikir komputasional dalam menyelesaikan persoalan.',
        },
      ],
      updatedAt: stamp,
    },
    tp: {
      id: `tp-${sem}`,
      academicSettingId: `sem-${sem}`,
      workflowStatus: 'SIAP',
      items: tpItems,
      updatedAt: stamp,
    },
    atp: {
      id: `atp-${sem}`,
      academicSettingId: `sem-${sem}`,
      rationale: 'Rasional alur pembelajaran dirancang logis dari dasar hingga aplikatif.',
      workflowStatus: 'SIAP',
      items: atpItems,
      updatedAt: stamp,
    },
    atpUnitMapping: {
      id: `mapping-${sem}`,atpId:`atp-${sem}`,
      academicSettingId: `sem-${sem}`,
      units,
      updatedAt: stamp,
    },
    unitExecutionPlan: {
      id: `exec-${sem}`,
      academicSettingId: `sem-${sem}`,
      mappingId: `mapping-${sem}`,
      units: executionUnits,
      semesterPlacement: { updatedAt:stamp,mode: 'CONTIGUOUS_BOUNDARY', semester1LastUnitId: 'unit-1' },
      basedOnMappingUpdatedAt: stamp,updatedAt:stamp,
    },
    learningMeetingSchedules: schedules,
    calendar: {
      id: `cal-${sem}`,
      academicSettingId: `sem-${sem}`,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-31`,
      schoolDaysPerWeek: 5,academicYear:'2026/2027',semester:sem==='1'?'1 (Ganjil)':'2 (Genap)',updatedAt:stamp,
      workflowStatus: 'CONFIRMED',
    },
    calendarDays,
    semesterJPSetting: {
      semesterPlanId: `sem-${sem}`,
      actualScheduledWeeklyJP: 3,
      source: 'TEACHER_CONFIRMED',
    },
    zipAnnualSource: {
      yearPlan: {
        id: 'year-1',level:'SMP',createdAt:stamp,updatedAt:stamp,
        profileId: 'teacher-1',
        schoolId: 'school-1',
        academicYear: '2026/2027',
        subject: 'Informatika',
        grade: 'Kelas 7',
        curriculumType: 'KURIKULUM_MERDEKA',
      },
      semesterPlans: [1, 2].map((n) => ({
        id: `sem-${n}`,
        yearPlanId: 'year-1',
        semester: n as 1|2,createdAt:stamp,
        updatedAt: stamp,
      })),
      semesterJPSettings: [1, 2].map((n) => ({
        semesterPlanId: `sem-${n}`,
        value: {
          semesterPlanId: `sem-${n}`,
          actualScheduledWeeklyJP: 3,
          source: 'TEACHER_CONFIRMED',
        },
      })),
      semesterData: {
        academicCalendar: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: {
            calendar: {
              id: `cal-${n}`,
              academicSettingId: `sem-${n}`,
              startDate: n === 1 ? '2026-10-01' : '2027-01-01',
              endDate: n === 1 ? '2026-10-31' : '2027-01-31',
              schoolDaysPerWeek: 5,academicYear:'2026/2027',semester:sem==='1'?'1 (Ganjil)':'2 (Genap)',updatedAt:stamp,
              workflowStatus: 'CONFIRMED',
            },
            days: Array.from({ length: 31 }, (_, i) => ({
              id: `d-${n}-${i + 1}`,
              academicCalendarId: `cal-${n}`,
              date: `${n === 1 ? '2026-10' : '2027-01'}-${String(i + 1).padStart(2, '0')}`,
              status: 'EFFECTIVE_LEARNING',
            })),
          },
        })),
        learningPlan: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: [],
        })),
        assessmentCriteria: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: [],
        })),
        learningMeetingSchedules: [1, 2].map((n) => ({
          semesterPlanId: `sem-${n}`,
          value: schedules[n - 1].schedule,
        })),
        timeAllocation: [],
        assessmentPlan: [],
        assessmentPackage: [],
        roster: [],
        attendance: [],
        grade: [],
        remedial: [],
        enrichment: [],
      },
    },
  };
}
