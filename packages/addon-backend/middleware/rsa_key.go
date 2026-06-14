package middleware

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"math/big"
)

// parseRSAPublicKey reconstructs an *rsa.PublicKey from base64url-encoded n and e.
func parseRSAPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}

	// Pad e to 8 bytes for uint64
	if len(eBytes) < 8 {
		padded := make([]byte, 8)
		copy(padded[8-len(eBytes):], eBytes)
		eBytes = padded
	}
	e := int(binary.BigEndian.Uint64(eBytes))

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: e,
	}, nil
}
