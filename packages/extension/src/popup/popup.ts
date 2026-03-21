import './popup.css';

// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    const target = (tab as HTMLElement).dataset.tab;
    document.getElementById(`tab-${target}`)?.classList.add('active');
  });
});

// Modal close handlers
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.modal-overlay')?.classList.add('hidden');
  });
});

console.log('doc-align popup loaded');
