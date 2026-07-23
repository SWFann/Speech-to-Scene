/**
 * ProjectListView — Phase 3 multi-project workspace listing.
 *
 * Shows all projects in the workspace with their titles, scene counts,
 * and last-updated timestamps. Clicking a project switches to it.
 * Also provides a "new project" button to enter the landing/upload view.
 */

import { useState } from "react";
import { Folder, Plus, Trash2, CheckCircle, AlertCircle } from "lucide-react";

import type { ProjectListItem } from "../types.js";
import type { ActionErrorInfo } from "./ActionError.js";
import { ActionError } from "./ActionError.js";

interface ProjectListViewProps {
  projects: readonly ProjectListItem[];
  activeProject: string | null;
  onSwitch: (project: string) => void;
  onCreate: () => void;
  onDelete: (project: string) => void;
  loading?: boolean;
  error?: ActionErrorInfo | null;
  onDismissError?: () => void;
}

export function ProjectListView({
  projects,
  onSwitch,
  onCreate,
  onDelete,
  loading,
  error,
  onDismissError,
}: ProjectListViewProps): React.ReactElement {
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const handleDeleteClick = (projectName: string): void => {
    setDeleteTarget(projectName);
    setConfirmText("");
  };

  const handleDeleteConfirm = (): void => {
    if (deleteTarget && confirmText === deleteTarget) {
      onDelete(deleteTarget);
      setDeleteTarget(null);
      setConfirmText("");
    }
  };

  const handleDeleteCancel = (): void => {
    setDeleteTarget(null);
    setConfirmText("");
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="mark">S2S</div>
          <strong>Speech-to-Scene</strong>
        </div>
        <div className="project-meta">
          <span>项目列表</span>
          <span className="status-pill ok">{projects.length} 个项目</span>
        </div>
        <div className="actions">
          <button className="btn primary" type="button" onClick={onCreate} title="创建新项目">
            <Plus size={14} />
            新建项目
          </button>
        </div>
      </header>

      {error && onDismissError && <ActionError error={error} onDismiss={onDismissError} />}

      {loading ? (
        <div className="loading-view">
          <p>正在加载项目列表…</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <Folder size={48} />
          <h2>暂无项目</h2>
          <p>点击「新建项目」上传文稿，开始制作场景。</p>
          <button className="btn primary" type="button" onClick={onCreate}>
            <Plus size={14} />
            新建项目
          </button>
        </div>
      ) : (
        <section className="project-list">
          {projects.map((project) => (
            <div
              key={project.name}
              className={`project-card ${project.isActive ? "active" : ""}`}
              onClick={() => onSwitch(project.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSwitch(project.name);
              }}
            >
              <div className="project-card-header">
                <div className="project-icon">
                  <Folder size={20} />
                </div>
                <div className="project-info">
                  <h3>{project.title}</h3>
                  <span className="project-name">{project.name}</span>
                </div>
                {project.isActive && (
                  <span className="status-pill ok">
                    <CheckCircle size={14} />
                    当前
                  </span>
                )}
              </div>
              <div className="project-card-meta">
                <span>{project.sceneCount} 个场景</span>
                <span>{formatDate(project.updatedAt)}</span>
              </div>
              <div className="project-card-actions">
                <button
                  className="btn danger"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(project.name);
                  }}
                  title="删除项目"
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={handleDeleteCancel}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <AlertCircle size={24} />
            </div>
            <h2>删除项目确认</h2>
            <p>
              即将删除项目 <strong>{deleteTarget}</strong>，
              此操作不可撤销。所有场景、素材和缓存将被清除。
            </p>
            <p className="confirm-hint">
              请输入项目名 <code>{deleteTarget}</code> 以确认：
            </p>
            <input
              type="text"
              placeholder={deleteTarget}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDeleteConfirm();
              }}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn" type="button" onClick={handleDeleteCancel}>
                取消
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={handleDeleteConfirm}
                disabled={confirmText !== deleteTarget}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
