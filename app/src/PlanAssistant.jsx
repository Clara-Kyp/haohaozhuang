import React from 'react';
import { exampleLayoutPrompt, layoutGoals } from './planTools';

export default function PlanAssistant({ planning, onChange, onGenerate, onReferences, onPreview, onApply, disabled }) {
  const count = planning.goals.length;
  return <section className="card plan-assistant" aria-label="AI 户型规划">
    <div className="card-title"><h2>AI 户型规划</h2><span className="status-chip">先看动线</span></div>
    <p className="card-sub">识别失败或不满意，都可以根据同一张底图重新规划。先比较方案，再决定是否应用。这里规划空间分隔，材质与家具在下一步装修中选择。</p>
    <div className="stack">
      <label>规划要求
        <textarea rows={6} maxLength={4000} value={planning.instruction} disabled={disabled}
          placeholder="例如：客厅可以缩小，保证前后院通行，卧室不作为过道……"
          onChange={e => onChange({ instruction: e.target.value })} />
      </label>
      <button className="pill" disabled={disabled} onClick={() => onChange({ instruction: exampleLayoutPrompt })}>填入规划示例</button>
      <fieldset className="layout-goals">
        <legend>布局目标</legend>
        <small>每选一项生成一套，最多比较三套。</small>
        {Object.entries(layoutGoals).map(([id, goal]) => (
          <label className="layout-goal check" key={id}>
            <input type="checkbox" checked={planning.goals.includes(id)} disabled={disabled}
              onChange={event => onChange({ goals: event.target.checked
                ? [...planning.goals, id]
                : planning.goals.filter(value => value !== id) })} />
            <span>{goal.label}<small>{goal.description}</small></span>
          </label>
        ))}
      </fieldset>
      <label>添加布局参考图（可选）
        <input type="file" aria-describedby="layout-reference-help" accept="image/png,image/jpeg,image/webp" multiple
          disabled={disabled || planning.references.length >= 3}
          onChange={e => { onReferences(Array.from(e.target.files)); e.target.value = ''; }} />
      </label>
      <small id="layout-reference-help">最多三张，例如开放式厨房示意或客餐厅连通的布局。</small>
      {planning.references.map((ref, index) => <div className="plan-reference" key={ref.id}>
        <img src={ref.image} alt={'布局参考图 ' + (index + 1)} />
        <label>参考图 {index + 1} 想借鉴的空间关系
          <input value={ref.label} maxLength={80} placeholder="例如：厨房与餐厅连通" disabled={disabled} onChange={e => onChange({
            references: planning.references.map(r => r.id === ref.id ? { ...r, label: e.target.value } : r),
          })} />
        </label>
        <button className="pill" disabled={disabled} onClick={() => onChange({ references: planning.references.filter(r => r.id !== ref.id) })}
          aria-label={'移除参考图 ' + (index + 1)}>移除</button>
      </div>)}
      <button className="btn-primary" disabled={disabled || !count || !planning.instruction.trim()} onClick={onGenerate}>
        {count ? `${planning.layouts.length ? '重新生成' : '生成'} ${count} 套布局方案` : '生成布局方案'}
      </button>
      {planning.error && <p role="alert" className="plan-error">{planning.error}</p>}
      <small>候选为平面功能分隔示意。承重、门窗、管井、净宽和原图边界需要核对；应用新布局会重建房间装修，原始底图与原布局保留。</small>
    </div>
    {planning.layouts.length > 0 && <div className="layout-candidates">
      <p className="kicker">{planning.model ? `模型：${planning.model}` : '模型候选'} · {planning.layouts.length} 套方案</p>
      {planning.layouts.map((plan, index) => <article key={plan.id}
        className={'layout-option ' + (planning.previewId === plan.id ? 'is-preview' : '')}>
        <div className="card-title"><h3>{String.fromCharCode(65 + index)} · {layoutGoals[plan.goal]?.label || '历史方案'}</h3>
          {planning.appliedId === plan.id && <span className="status-chip">已应用</span>}</div>
        <strong>{plan.title}</strong><p>{plan.summary}</p>
        <p><b>动线策略：</b>{plan.circulation.summary}</p>
        {plan.retained && <p><b>保留与调整：</b>{plan.retained}</p>}
        {plan.tradeoffs?.length > 0 && <p><b>方案取舍：</b>{plan.tradeoffs.join('；')}</p>}
        {plan.verification?.length > 0 && <p><b>待核实：</b>{plan.verification.join('；')}</p>}
        <div className="row">
          <button className="pill" disabled={disabled} aria-pressed={planning.previewId === plan.id}
            onClick={() => onPreview(planning.previewId === plan.id ? null : plan.id)}>
            {planning.previewId === plan.id ? '退出预览' : `预览方案 ${String.fromCharCode(65 + index)}`}</button>
          <button className="btn-primary pill" disabled={disabled} onClick={() => onApply(plan)}>应用此布局</button>
        </div>
      </article>)}
    </div>}
  </section>;
}
