import React, { useState, useRef, useEffect, useCallback } from 'react';

interface MentionOption {
  id: string;
  name: string;
  email: string;
}

interface MentionInputProps {
  options: MentionOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  placeholder?: string;
}

export function MentionInput({ options, selectedIds, onToggle, placeholder }: MentionInputProps) {
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filtered = options.filter(
    (o) =>
      !selectedIds.includes(o.id) &&
      (o.name.toLowerCase().includes(query.toLowerCase()) ||
        o.email.toLowerCase().includes(query.toLowerCase()))
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showDropdown || filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[highlightIndex]) {
          onToggle(filtered[highlightIndex].id);
          setQuery('');
          setShowDropdown(false);
        }
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    },
    [showDropdown, filtered, highlightIndex, onToggle]
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowDropdown(true);
          setHighlightIndex(0);
        }}
        onFocus={() => setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Type @ to add a signer...'}
        style={{
          width: '100%',
          padding: '8px 12px',
          border: '1px solid #dadce0',
          borderRadius: 8,
          fontSize: 13,
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      {showDropdown && filtered.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            backgroundColor: '#fff',
            border: '1px solid #dadce0',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            zIndex: 100,
            maxHeight: 200,
            overflowY: 'auto',
            marginTop: 4,
          }}
        >
          {filtered.map((opt, i) => (
            <div
              key={opt.id}
              onClick={() => {
                onToggle(opt.id);
                setQuery('');
                setShowDropdown(false);
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                backgroundColor: i === highlightIndex ? '#f5f0ff' : 'transparent',
                fontSize: 13,
              }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <div style={{ fontWeight: 500 }}>{opt.name}</div>
              <div style={{ fontSize: 11, color: '#5f6368' }}>{opt.email}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
