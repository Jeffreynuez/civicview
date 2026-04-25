'use client';

import { useState } from 'react';
import { lookupAddress } from '@/lib/api';

const PARTY_COLORS = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
const PARTY_NAMES = { R: 'Republican', D: 'Democrat', I: 'Independent' };

export default function AddressLookup({ onResult, onMemberSelect }) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!address.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    const data = await lookupAddress(address.trim());

    if (data.success) {
      setResult(data);
      if (onResult) onResult(data);
    } else {
      setError(data.error);
    }

    setLoading(false);
  };

  const MemberCard = ({ member, label }) => {
    if (!member) return null;
    const party = member.party || 'I';
    return (
      <div
        onClick={() => onMemberSelect && onMemberSelect(member)}
        style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
          borderRadius: '10px', cursor: 'pointer', border: '1px solid var(--border)',
          marginBottom: '6px', background: 'white', transition: 'all 0.15s',
        }}
        onMouseOver={(e) => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseOut={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        {member.photoUrl ? (
          <img
            src={member.photoUrl}
            alt={member.name}
            style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)', flexShrink: 0 }}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div style={{
          width: '48px', height: '48px', borderRadius: '50%', background: '#e9ecef',
          display: member.photoUrl ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', fontWeight: 700, color: '#999', flexShrink: 0,
        }}>
          {member.name.split(' ').map((n) => n[0]).join('')}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
            {label}
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>{member.name}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-light)' }}>{member.title || member.role}</div>
        </div>
        <span style={{
          padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700,
          background: party === 'R' ? '#fde8e8' : party === 'D' ? '#e3f0f7' : '#f0eaff',
          color: PARTY_COLORS[party],
        }}>
          {PARTY_NAMES[party]}
        </span>
      </div>
    );
  };

  return (
    <div style={{ padding: '16px' }}>
      {/* Search Form */}
      <form onSubmit={handleSubmit} style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '8px' }}>
          Find Your Representatives
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginBottom: '10px' }}>
          Enter your home address to see exactly who represents you in Congress.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. 123 Main St, Orlando, FL 32801"
            style={{
              flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)',
              fontSize: '0.88rem', outline: 'none', transition: 'border-color 0.2s',
            }}
            onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.target.style.borderColor = 'var(--border)')}
          />
          <button
            type="submit"
            disabled={loading || !address.trim()}
            style={{
              padding: '10px 18px', background: 'var(--accent)', color: 'white', border: 'none',
              borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: loading ? 'wait' : 'pointer',
              opacity: loading || !address.trim() ? 0.6 : 1, whiteSpace: 'nowrap', transition: 'opacity 0.2s',
            }}
          >
            {loading ? 'Looking up...' : 'Look Up'}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div style={{
          padding: '12px', background: '#fde8e8', borderRadius: '8px', fontSize: '0.85rem',
          color: '#721c24', marginBottom: '12px',
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* District Badge */}
          <div style={{
            padding: '12px 16px', background: 'var(--bg)', borderRadius: '10px',
            marginBottom: '12px', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Your District
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)', marginTop: '2px' }}>
              {result.districtLabel || `${result.stateCode} — ${result.district || 'Unknown'}`}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-light)', marginTop: '2px' }}>
              {result.address}
            </div>
          </div>

          {/* Your Rep */}
          {result.yourRepresentative && (
            <MemberCard member={result.yourRepresentative} label="Your Representative" />
          )}

          {/* Your Senators */}
          {result.yourSenators.map((s) => (
            <MemberCard key={s.id} member={s} label="Your Senator" />
          ))}
        </div>
      )}
    </div>
  );
}
