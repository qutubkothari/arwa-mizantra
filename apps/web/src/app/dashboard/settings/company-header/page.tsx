import LetterheadSettings from '../components/LetterheadSettings';

export default function CompanyHeaderSettingsPage() {
  return (
    <div className="bg-[#F8F3EA] p-5">
      <div className="mb-4 border-b pb-4" style={{ borderColor: '#E8DCC4' }}>
        <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#8B6F47' }}>Settings</p>
        <h1 className="text-2xl font-bold" style={{ color: '#3B2A1E' }}>Company Header</h1>
      </div>
      <LetterheadSettings />
    </div>
  );
}
