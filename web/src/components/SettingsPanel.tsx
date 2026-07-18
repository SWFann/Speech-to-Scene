import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ReviewApiClient } from "../api/review-api.js";
import type { SettingsView } from "../types.js";

interface SettingsPanelProps {
  client: ReviewApiClient;
  onClose: () => void;
}

export function SettingsPanel({ client, onClose }: SettingsPanelProps): React.ReactElement {
  const [view, setView] = useState<SettingsView | null>(null);
  const [pexelsKey, setPexelsKey] = useState("");
  const [pixabayKey, setPixabayKey] = useState("");
  const [unsplashKey, setUnsplashKey] = useState("");
  const [planner, setPlanner] = useState("fixture");
  const [plannerKey, setPlannerKey] = useState("");
  const [stepImageModel, setStepImageModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client
      .getSettings()
      .then((v) => {
        setView(v);
        setPlanner(v.plannerProvider);
        setStepImageModel(v.stepImageModel || "");
      })
      .catch(() => {});
  }, [client]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    const body: Record<string, unknown> = { plannerProvider: planner };
    if (pexelsKey) body.pexelsApiKey = pexelsKey;
    if (pixabayKey) body.pixabayApiKey = pixabayKey;
    if (unsplashKey) body.unsplashApiKey = unsplashKey;
    if (planner === "deepseek" && plannerKey) body.deepseekApiKey = plannerKey;
    if (planner === "stepfun" && plannerKey) body.stepApiKey = plannerKey;
    if (stepImageModel) body.stepImageModel = stepImageModel;
    try {
      const v = await client.saveSettings(body);
      setView(v);
      setPexelsKey("");
      setPixabayKey("");
      setUnsplashKey("");
      setPlannerKey("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const plannerKeyConfigured =
    view !== null &&
    ((planner === "deepseek" && view.hasDeepseekKey) || (planner === "stepfun" && view.hasStepKey));

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>API Key 配置</h2>
          <button className="icon-btn" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {view && (
          <div className="settings-body">
            <label>Planner 提供方</label>
            <select
              value={planner}
              onChange={(e) => setPlanner(e.target.value)}
              disabled={saving}
            >
              <option value="fixture">Fixture（测试，不联网）</option>
              <option value="deepseek">DeepSeek</option>
              <option value="stepfun">StepFun</option>
            </select>
            {planner !== "fixture" && (
              <>
                <label>{planner === "deepseek" ? "DeepSeek" : "StepFun"} API Key</label>
                <input
                  type="password"
                  placeholder={plannerKeyConfigured ? "已配置，留空不修改" : "粘贴 API Key"}
                  value={plannerKey}
                  onChange={(e) => setPlannerKey(e.target.value)}
                  disabled={saving}
                />
              </>
            )}

            <h3 className="settings-section-title">AI 图片生成</h3>
            <label>StepFun 图片生成模型</label>
            <input
              type="text"
              placeholder={view?.stepImageModel || "step-image-edit-2"}
              value={stepImageModel}
              onChange={(e) => setStepImageModel(e.target.value)}
              disabled={saving}
            />
            <p className="settings-hint">
              复用 StepFun API Key。留空使用默认模型 step-image-edit-2。可用模型：step-image-edit-2、search-image。
            </p>

            <h3 className="settings-section-title">图库 API Key</h3>
            <label>Pexels API Key</label>
            <input
              type="password"
              placeholder={view?.hasPexelsKey ? "已配置，留空不修改" : "粘贴 Pexels API Key"}
              value={pexelsKey}
              onChange={(e) => setPexelsKey(e.target.value)}
              disabled={saving}
            />
            <label>Pixabay API Key</label>
            <input
              type="password"
              placeholder={view?.hasPixabayKey ? "已配置，留空不修改" : "粘贴 Pixabay API Key"}
              value={pixabayKey}
              onChange={(e) => setPixabayKey(e.target.value)}
              disabled={saving}
            />
            <label>Unsplash API Key</label>
            <input
              type="password"
              placeholder={view?.hasUnsplashKey ? "已配置，留空不修改" : "粘贴 Unsplash API Key"}
              value={unsplashKey}
              onChange={(e) => setUnsplashKey(e.target.value)}
              disabled={saving}
            />
            <p className="settings-hint">
              Openverse 无需 API Key。配置多个图库后，搜索将自动聚合所有可用源。
            </p>

            {saved && <span className="settings-saved">已保存</span>}
            <button
              className="btn primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <p className="settings-hint">Key 保存在本地 .s2s/settings.json，不入 Git。</p>
          </div>
        )}
      </div>
    </div>
  );
}
