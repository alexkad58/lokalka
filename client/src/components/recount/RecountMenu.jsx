export default function RecountMenu({
  menuOpen,
  setMenuOpen,
  handleSaveNow,
  setMismatchFilter,
  setMismatchModalOpen,
  hideCompletedItems,
  setHideCompletedItems,
  mismatchItems,
  openCompleteModal,
  handleFinishWithoutPdf,
  loading,
  goHome,
  deleteActiveRecount,
  deletingRecountId,
  activeRecount
}) {
  return (
    <div className={`menu-popup ${menuOpen ? 'open' : ''}`}>
      <button type="button" onClick={handleSaveNow}>Сохранить сейчас</button>
      <button type="button" onClick={() => {
        setMismatchFilter('all');
        setMismatchModalOpen(true);
        setMenuOpen(false);
      }}>
        Расхождения ({mismatchItems.length})
      </button>
      <button
        type="button"
        className={hideCompletedItems ? 'active' : ''}
        onClick={() => setHideCompletedItems(prev => !prev)}
      >
        {hideCompletedItems ? 'Показывать отошедшее' : 'Скрыть отошедшее'}
      </button>
      <button type="button" onClick={() => {
        openCompleteModal();
        setMenuOpen(false);
      }}>
        Завершить
      </button>
      <button type="button" onClick={handleFinishWithoutPdf} disabled={loading}>
        Завершить без PDF
      </button>
      <button type="button" onClick={goHome}>На главный</button>
      <button type="button" className="danger" onClick={deleteActiveRecount} disabled={deletingRecountId === activeRecount?.id}>
        {deletingRecountId === activeRecount?.id ? 'Удаление...' : 'Удалить просчет'}
      </button>
    </div>
  );
}
