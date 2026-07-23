import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Search, Sparkles, X } from "lucide-react";
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getSettings()
      .then((v) => {
        setView(v);
        setPlanner(v.plannerProvider);
        setStepImageModel(v.stepImageModel || "");
      })
      .catch(() => setError("无法读取本地配置，请确认 Review Server 正常运行。"));
  }, [client]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setSaved(false);
    setError(null);
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
    } catch {
      setError("保存失败。原有密钥没有被清除，请稍后重试。");
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
          <div>
            <h2>连接服务</h2>
            <p>配置一次，之后创建项目会自动使用。</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={18} />
          </button>
        </div>
        {view && (
          <div className="settings-body">
            {error && <div className="settings-error">{error}</div>}
            <section className="settings-group">
              <div className="settings-group-heading">
                <Sparkles size={18} />
                <div>
                  <h3>AI 场景规划与生图</h3>
                  <p>推荐 StepFun：负责拆分文稿，也可生成缺少的画面。</p>
                </div>
              </div>
              <label>场景规划模型</label>
              <select
                value={planner}
                onChange={(e) => setPlanner(e.target.value)}
                disabled={saving}
              >
                <option value="stepfun">StepFun（推荐）</option>
                <option value="deepseek">DeepSeek</option>
                <option value="fixture">演示模式（不联网）</option>
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

              <label>StepFun 图片生成模型</label>
              <input
                type="text"
                placeholder={view?.stepImageModel || "step-image-edit-2"}
                value={stepImageModel}
                onChange={(e) => setStepImageModel(e.target.value)}
                disabled={saving}
              />
              <p className="settings-hint">一般保持默认即可。图片生成会复用上面的 StepFun Key。</p>
            </section>

            <section className="settings-group">
              <div className="settings-group-heading">
                <Search size={18} />
                <div>
                  <h3>真实素材来源</h3>
                  <p>Openverse 默认可用；多配置一个图库，就多一个真实搜索来源。</p>
                </div>
              </div>
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
            </section>

            {saved && (
              <span className="settings-saved">
                <CheckCircle2 size={14} /> 已安全保存到本机
              </span>
            )}
            <button
              className="btn primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <p className="settings-privacy">
              <KeyRound size={13} /> 密钥只保存在本机，不会显示在页面或写入项目文件。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
