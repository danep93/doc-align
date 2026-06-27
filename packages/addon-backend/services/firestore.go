package services

import (
	"context"
	"time"

	"cloud.google.com/go/firestore"
)

type DocRecord struct {
	Title               string    `firestore:"title"`
	OwnerID             string    `firestore:"ownerId"`
	OwnerRefreshToken   string    `firestore:"ownerRefreshToken"` // plaintext for MVP; KMS in Phase 2
	BaselineRevisionID  string    `firestore:"baselineRevisionId"`
	LastDriftCheckedAt  time.Time `firestore:"lastDriftCheckedAt"`
	CreatedAt           time.Time `firestore:"createdAt"`
}

type SignerRecord struct {
	Status            string    `firestore:"status"` // pending | signed | drifted
	SignedAt          time.Time `firestore:"signedAt"`
	SignedRevisionID  string    `firestore:"signedRevisionId"`
	CommitMessage     string    `firestore:"commitMessage"`
	DriftDetectedAt   time.Time `firestore:"driftDetectedAt"`
	NotifiedAt        time.Time `firestore:"notifiedAt"`
}

type HistoryRecord struct {
	Action        string    `firestore:"action"`
	ActorEmail    string    `firestore:"actorEmail"`
	ActorName     string    `firestore:"actorName"`
	CommitMessage string    `firestore:"commitMessage"`
	RevisionID    string    `firestore:"revisionId"`
	Timestamp     time.Time `firestore:"timestamp"`
}

type Store struct {
	client *firestore.Client
}

func NewStore(client *firestore.Client) *Store {
	return &Store{client: client}
}

func (s *Store) FirestoreClient() *firestore.Client {
	return s.client
}

func (s *Store) GetDoc(ctx context.Context, docID string) (*DocRecord, error) {
	snap, err := s.client.Collection("documents").Doc(docID).Get(ctx)
	if err != nil {
		return nil, err
	}
	var rec DocRecord
	if err := snap.DataTo(&rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) CreateDoc(ctx context.Context, docID string, rec DocRecord) error {
	_, err := s.client.Collection("documents").Doc(docID).Set(ctx, rec)
	return err
}

func (s *Store) UpdateBaselineRevision(ctx context.Context, docID, revID string) error {
	_, err := s.client.Collection("documents").Doc(docID).Update(ctx, []firestore.Update{
		{Path: "baselineRevisionId", Value: revID},
	})
	return err
}

func (s *Store) UpdateLastDriftCheck(ctx context.Context, docID string, t time.Time) error {
	_, err := s.client.Collection("documents").Doc(docID).Update(ctx, []firestore.Update{
		{Path: "lastDriftCheckedAt", Value: t},
	})
	return err
}

func (s *Store) GetSigner(ctx context.Context, docID, email string) (*SignerRecord, error) {
	snap, err := s.client.Collection("documents").Doc(docID).Collection("signers").Doc(email).Get(ctx)
	if err != nil {
		return nil, err
	}
	var rec SignerRecord
	if err := snap.DataTo(&rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) ListSigners(ctx context.Context, docID string) (map[string]SignerRecord, error) {
	docs, err := s.client.Collection("documents").Doc(docID).Collection("signers").Documents(ctx).GetAll()
	if err != nil {
		return nil, err
	}
	result := make(map[string]SignerRecord, len(docs))
	for _, d := range docs {
		var rec SignerRecord
		if err := d.DataTo(&rec); err != nil {
			return nil, err
		}
		result[d.Ref.ID] = rec
	}
	return result, nil
}

func (s *Store) SetSigner(ctx context.Context, docID, email string, rec SignerRecord) error {
	_, err := s.client.Collection("documents").Doc(docID).Collection("signers").Doc(email).Set(ctx, rec)
	return err
}

func (s *Store) DeleteSigner(ctx context.Context, docID, email string) error {
	_, err := s.client.Collection("documents").Doc(docID).Collection("signers").Doc(email).Delete(ctx)
	return err
}

func (s *Store) UpdateSignerStatus(ctx context.Context, docID, email, status string, updates map[string]interface{}) error {
	up := []firestore.Update{{Path: "status", Value: status}}
	for k, v := range updates {
		up = append(up, firestore.Update{Path: k, Value: v})
	}
	_, err := s.client.Collection("documents").Doc(docID).Collection("signers").Doc(email).Update(ctx, up)
	return err
}

func (s *Store) AddHistory(ctx context.Context, docID string, rec HistoryRecord) error {
	_, _, err := s.client.Collection("documents").Doc(docID).Collection("history").Add(ctx, rec)
	return err
}

func (s *Store) ListHistory(ctx context.Context, docID string) ([]HistoryRecord, error) {
	docs, err := s.client.Collection("documents").Doc(docID).Collection("history").
		OrderBy("timestamp", firestore.Desc).Documents(ctx).GetAll()
	if err != nil {
		return nil, err
	}
	result := make([]HistoryRecord, 0, len(docs))
	for _, d := range docs {
		var rec HistoryRecord
		if err := d.DataTo(&rec); err != nil {
			return nil, err
		}
		result = append(result, rec)
	}
	return result, nil
}
