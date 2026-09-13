export default function CompleteModal({
  completeModalOpen,
  setCompleteModalOpen,
  counterName,
  setCounterName,
  groupName,
  setGroupName,
  includeTotalSummary,
  setIncludeTotalSummary,
  includeDiscrepancyTable,
  setIncludeDiscrepancyTable,
  activeRecount,
  updateCompletionTime,
  setUpdateCompletionTime,
  handleCompleteRecount,
  loading
}) {
  if (!completeModalOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setCompleteModalOpen(false)}>
      <div className="modal-card" onClick={event => event.stopPropagation()}>
        <h3>Завершение просчета</h3>
        <input
          value={counterName}
          onChange={event => setCounterName(event.target.value)}
          placeholder="Просчитывающий"
        />
        <input
          value={groupName}
          onChange={event => setGroupName(event.target.value)}
          placeholder="Товарная группа"
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeTotalSummary}
            onChange={event => setIncludeTotalSummary(event.target.checked)}
          />
          Свести -/+
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeDiscrepancyTable}
            onChange={event => setIncludeDiscrepancyTable(event.target.checked)}
          />
          Таблица расхождений
        </label>
        {activeRecount?.completedAt ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={updateCompletionTime}
              onChange={event => setUpdateCompletionTime(event.target.checked)}
            />
            Обновить время просчета
          </label>
        ) : null}
        <button type="button" onClick={handleCompleteRecount} disabled={loading}>Скачать итоговый PDF и завершить</button>
        <button type="button" className="ghost" onClick={() => setCompleteModalOpen(false)}>Отмена</button>
      </div>
    </div>
  );
}
