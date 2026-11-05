import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Lock } from 'lucide-react';

export type AnnualPlanningTaskStatus =
  | 'COMPLETE'
  | 'PENDING'
  | 'NEEDS_REVIEW';

export interface AnnualPlanningTaskRailItem {
  id: string;
  title: string;
  status: AnnualPlanningTaskStatus;
  detail?: string;
  isLocked?: boolean;
  lockReason?: string;
}

interface AnnualPlanningTaskRailProps {
  tasks: AnnualPlanningTaskRailItem[];
  onSelectTask: (taskId: string) => void;
  activeTaskId: string;
}

const getStatusIcon = (status: AnnualPlanningTaskStatus, isLocked?: boolean) => {
  if (isLocked) {
    return <Lock className="w-3.5 h-3.5 text-slate-400" />;
  }
  if (status === 'COMPLETE') {
    return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  }
  if (status === 'NEEDS_REVIEW') {
    return <AlertTriangle className="w-4 h-4 text-amber-600" />;
  }
  return <Circle className="w-4 h-4 text-slate-300" />;
};

const getTaskClassName = (task: AnnualPlanningTaskRailItem, isActive: boolean) => {
  if (task.isLocked) {
    return 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed opacity-75';
  }
  if (isActive) {
    return 'border-blue-500 bg-blue-50 text-blue-950 ring-2 ring-blue-600/30';
  }
  if (task.status === 'COMPLETE') {
    return 'border-emerald-200 bg-emerald-50/60 text-emerald-950 hover:bg-emerald-100/50';
  }
  if (task.status === 'NEEDS_REVIEW') {
    return 'border-amber-300 bg-amber-50/60 text-amber-950 hover:bg-amber-100/50';
  }
  return 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
};

export const AnnualPlanningTaskRail: React.FC<AnnualPlanningTaskRailProps> = ({
  tasks,
  onSelectTask,
  activeTaskId,
}) => {
  const completedCount = tasks.filter((task) => task.status === 'COMPLETE').length;
  const nextTask = tasks.find((task) => task.status !== 'COMPLETE');

  return (
    <>
      <aside className="hidden lg:block w-[260px] shrink-0">
        <div className="sticky top-4 bg-white border border-slate-200 rounded-xl shadow-xs p-3 space-y-2">
          <div className="px-1 pb-2 border-b border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Alur Perencanaan
            </p>
            <p className="text-sm font-bold text-slate-900 mt-0.5">
              {completedCount} dari {tasks.length} selesai
            </p>
          </div>

          <div className="space-y-2">
            {tasks.map((task, index) => {
              const isActive = task.id === activeTaskId;
              return (
                <button
                  key={task.id}
                  type="button"
                  disabled={task.isLocked}
                  onClick={() => !task.isLocked && onSelectTask(task.id)}
                  className={`w-full text-left rounded-xl border p-3 transition cursor-pointer ${getTaskClassName(task, isActive)}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">
                      {getStatusIcon(task.status, task.isLocked)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Langkah {index + 1}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white font-bold text-[9px] uppercase tracking-wide">
                            Sedang dibuka
                          </span>
                        )}
                        {!isActive && task.status === 'COMPLETE' && (
                          <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[9px] uppercase tracking-wide">
                            Selesai
                          </span>
                        )}
                        {!isActive && task.status === 'NEEDS_REVIEW' && (
                          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[9px] uppercase tracking-wide">
                            Review
                          </span>
                        )}
                        {!isActive && task.isLocked && (
                          <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 font-bold text-[9px] uppercase tracking-wide">
                            Kunci
                          </span>
                        )}
                      </div>
                      <span className="block text-sm font-bold leading-snug mt-0.5">
                        {task.title}
                      </span>
                      {task.isLocked && task.lockReason && (
                        <span className="block mt-1 text-[10px] font-medium text-rose-700 leading-normal">
                          🔒 {task.lockReason}
                        </span>
                      )}
                      {!task.isLocked && task.detail && (
                        <span className="block mt-1 text-[11px] font-medium text-slate-600 leading-normal">
                          {task.detail}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <div className="lg:hidden bg-white rounded-xl border border-slate-200 shadow-xs p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Progress Step 08
            </p>
            <p className="text-sm font-bold text-slate-900">
              {completedCount} dari {tasks.length} selesai
            </p>
            <p className="text-xs text-slate-600 mt-1">
              Buka: <strong className="text-blue-900">{tasks.find(t => t.id === activeTaskId)?.title}</strong>
            </p>
          </div>
          {nextTask && (
            <button
              type="button"
              onClick={() => onSelectTask(nextTask.id)}
              className="shrink-0 px-3 py-2 rounded-lg bg-blue-900 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              Lanjut
            </button>
          )}
        </div>
      </div>
    </>
  );
};
