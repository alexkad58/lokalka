import ScannerHeader from './ScannerHeader.jsx';
import ItemsFeed from './ItemsFeed.jsx';
import RecountMenu from './RecountMenu.jsx';
import MismatchModal from './MismatchModal.jsx';
import CompleteModal from './CompleteModal.jsx';
import BindModal from './BindModal.jsx';
import FactKeypad from '../FactKeypad.jsx';

export default function RecountPage({
  // Scanner props
  scanSuccessFlash,
  scannerOn,
  toggleScanner,
  torchOn,
  toggleTorch,
  videoRef,
  focusScannerCamera,
  handleScannerDoubleClick,
  loading,
  scannerStatus,
  progressSummary,
  unresolvedBarcode,
  candidateCodes,
  openBindModal,
  bindTargetBarcode,
  hiddenCompletedMatch,
  // Search & Status
  search,
  setSearch,
  error,
  // Items feed
  itemsFeedRef,
  activeFactCode,
  filteredItems,
  computeRowState,
  values,
  itemCardRefs,
  updateFact,
  handleFactFocus,
  handleFactBlur,
  // Menu & actions
  menuOpen,
  setMenuOpen,
  handleSaveNow,
  mismatchFilter,
  setMismatchFilter,
  mismatchModalOpen,
  setMismatchModalOpen,
  hideCompletedItems,
  setHideCompletedItems,
  mismatchItems,
  openCompleteModal,
  handleFinishWithoutPdf,
  goHome,
  deleteActiveRecount,
  deletingRecountId,
  activeRecount,
  // Keypad
  keypadRef,
  appendToActiveFact,
  eraseActiveFact,
  keepFactKeypadOpen,
  // Complete modal
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
  updateCompletionTime,
  setUpdateCompletionTime,
  handleCompleteRecount,
  // Bind modal
  bindModalOpen,
  closeBindModal,
  candidateItems,
  bindBarcodeToSelectedItem,
  bindSearch,
  setBindSearch,
  bindFilteredItems
}) {
  return (
    <div className="recount-page">
      <div className="recount-top">
        <ScannerHeader
          scanSuccessFlash={scanSuccessFlash}
          scannerOn={scannerOn}
          videoRef={videoRef}
          focusScannerCamera={focusScannerCamera}
          handleScannerDoubleClick={handleScannerDoubleClick}
          loading={loading}
          scannerStatus={scannerStatus}
          progressSummary={progressSummary}
          unresolvedBarcode={unresolvedBarcode}
          candidateCodes={candidateCodes}
          openBindModal={openBindModal}
          bindTargetBarcode={bindTargetBarcode}
          hiddenCompletedMatch={hiddenCompletedMatch}
        />

        <section className="search-block">
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Поиск по артикулу или названию"
          />
          {search ? (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="Очистить поиск"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          ) : null}
        </section>

        {error ? <section className="status error">{error}</section> : null}
      </div>

      <ItemsFeed
        itemsFeedRef={itemsFeedRef}
        activeFactCode={activeFactCode}
        filteredItems={filteredItems}
        computeRowState={computeRowState}
        values={values}
        itemCardRefs={itemCardRefs}
        updateFact={updateFact}
        handleFactFocus={handleFactFocus}
        handleFactBlur={handleFactBlur}
      />

      <RecountMenu
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        handleSaveNow={handleSaveNow}
        setMismatchFilter={setMismatchFilter}
        setMismatchModalOpen={setMismatchModalOpen}
        hideCompletedItems={hideCompletedItems}
        setHideCompletedItems={setHideCompletedItems}
        mismatchItems={mismatchItems}
        openCompleteModal={openCompleteModal}
        handleFinishWithoutPdf={handleFinishWithoutPdf}
        loading={loading}
        goHome={goHome}
        deleteActiveRecount={deleteActiveRecount}
        deletingRecountId={deletingRecountId}
        activeRecount={activeRecount}
      />

      <nav className="bottom-actions">
        <button type="button" className={scannerOn ? 'active' : ''} onClick={toggleScanner}>Сканер</button>
        <button type="button" className={torchOn ? 'active' : ''} onClick={toggleTorch}>Фонарик</button>
        <button type="button" className={menuOpen ? 'active' : ''} onClick={() => setMenuOpen(prev => !prev)}>Меню</button>
      </nav>

      {activeFactCode ? (
        <FactKeypad
          ref={keypadRef}
          value={values[activeFactCode] || ''}
          onAppend={appendToActiveFact}
          onErase={eraseActiveFact}
          onKeepOpen={keepFactKeypadOpen}
        />
      ) : null}

      <MismatchModal
        mismatchModalOpen={mismatchModalOpen}
        setMismatchModalOpen={setMismatchModalOpen}
        mismatchFilter={mismatchFilter}
        setMismatchFilter={setMismatchFilter}
        mismatchItems={mismatchItems}
      />

      <CompleteModal
        completeModalOpen={completeModalOpen}
        setCompleteModalOpen={setCompleteModalOpen}
        counterName={counterName}
        setCounterName={setCounterName}
        groupName={groupName}
        setGroupName={setGroupName}
        includeTotalSummary={includeTotalSummary}
        setIncludeTotalSummary={setIncludeTotalSummary}
        includeDiscrepancyTable={includeDiscrepancyTable}
        setIncludeDiscrepancyTable={setIncludeDiscrepancyTable}
        activeRecount={activeRecount}
        updateCompletionTime={updateCompletionTime}
        setUpdateCompletionTime={setUpdateCompletionTime}
        handleCompleteRecount={handleCompleteRecount}
        loading={loading}
      />

      <BindModal
        bindModalOpen={bindModalOpen}
        closeBindModal={closeBindModal}
        bindTargetBarcode={bindTargetBarcode}
        unresolvedBarcode={unresolvedBarcode}
        candidateItems={candidateItems}
        bindBarcodeToSelectedItem={bindBarcodeToSelectedItem}
        bindSearch={bindSearch}
        setBindSearch={setBindSearch}
        bindFilteredItems={bindFilteredItems}
      />
    </div>
  );
}
