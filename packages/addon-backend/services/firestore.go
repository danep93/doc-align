package services

import (
	"context"
	"time"

	"cloud.google.com/go/firestore"
)

type DocRecord struct {
	Title                 string         `firestore:"title"`
	OwnerID               string         `firestore:"ownerId"`
	BaselineRevisionID    string         `firestore:"baselineRevisionId"`
	ConfirmedVersion      int            `firestore:"confirmedVersion"`
	ConfirmedModifiedTime time.Time      `firestore:"confirmedModifiedTime"`
	ChangeSummary         *ChangeSummary `firestore:"changeSummary"`
	CreatedAt             time.Time      `firestore:"createdAt"`
}

// ChangeSummary is the only record of what changed between confirmed versions.
// Section headings and line counts only — document content is never stored.
type ChangeSummary struct {
	Note           string          `firestore:"note"`
	Sections       []ChangeSection `firestore:"sections"`
	TotalAdded     int             `firestore:"totalAdded"`
	TotalRemoved   int             `firestore:"totalRemoved"`
	FromRevisionID string          `firestore:"fromRevisionId"`
	ToRevisionID   string          `firestore:"toRevisionId"`
}

type ChangeSection struct {
	Title   string `firestore:"title"`
	Added   int    `firestore:"added"`
	Removed int    `firestore:"removed"`
}

type SignerRecord struct {
	Status          string    `firestore:"status"` // pending | signed | drifted
	SignedAt        time.Time `firestore:"signedAt"`
	SignedVersion   int       `firestore:"signedVersion"`
	CommitMessage   string    `firestore:"commitMessage"`
	DriftDetectedAt time.Time `firestore:"driftDetectedAt"`
	NotifiedAt      time.Time `firestore:"notifiedAt"`
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

// ConfirmNewVersion atomically records the owner's confirmation of the current doc state:
// new version number, the Drive modifiedTime captured at confirm, the computed change
// summary, and the freshly pinned baseline revision.
func (s *Store) ConfirmNewVersion(ctx context.Context, docID string, newVersion int, summary ChangeSummary, newBaselineRevID string, modifiedTime time.Time) error {
	_, err := s.client.Collection("documents").Doc(docID).Update(ctx, []firestore.Update{
		{Path: "confirmedVersion", Value: newVersion},
		{Path: "confirmedModifiedTime", Value: modifiedTime},
		{Path: "changeSummary", Value: summary},
		{Path: "baselineRevisionId", Value: newBaselineRevID},
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

// IntegrationConfigRecord stores a user's API key for a third-party integration.
// Path: integrations/{userEmail}/providers/{provider}
type IntegrationConfigRecord struct {
	APIKey      string    `firestore:"apiKey"`
	ViewerEmail string    `firestore:"viewerEmail"` // verified at connect time
	ConnectedAt time.Time `firestore:"connectedAt"`
}

// TicketRecord is a provider-agnostic reference to an external issue.
// Path: documents/{docID}/tickets/{autoID}
// The ID field is populated from the Firestore document ID on read; it is not stored.
type TicketRecord struct {
	ID          string    `firestore:"-"             json:"id"`
	Provider    string    `firestore:"provider"      json:"provider"`
	ExternalID  string    `firestore:"externalId"    json:"externalId"`
	ExternalURL string    `firestore:"externalUrl"   json:"externalUrl"`
	Title       string    `firestore:"title"         json:"title"`
	Description string    `firestore:"description"   json:"description"`
	TeamID      string    `firestore:"teamId"        json:"teamId"`
	CreatedBy   string    `firestore:"createdBy"     json:"createdBy"`
	CreatedAt   time.Time `firestore:"createdAt"     json:"createdAt"`
	UpdatedAt   time.Time `firestore:"updatedAt"     json:"updatedAt"`
}

func (s *Store) GetIntegrationConfig(ctx context.Context, userEmail, provider string) (*IntegrationConfigRecord, error) {
	snap, err := s.client.Collection("integrations").Doc(userEmail).
		Collection("providers").Doc(provider).Get(ctx)
	if err != nil {
		return nil, err
	}
	var rec IntegrationConfigRecord
	if err := snap.DataTo(&rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (s *Store) SetIntegrationConfig(ctx context.Context, userEmail, provider string, rec IntegrationConfigRecord) error {
	_, err := s.client.Collection("integrations").Doc(userEmail).
		Collection("providers").Doc(provider).Set(ctx, rec)
	return err
}

func (s *Store) DeleteIntegrationConfig(ctx context.Context, userEmail, provider string) error {
	_, err := s.client.Collection("integrations").Doc(userEmail).
		Collection("providers").Doc(provider).Delete(ctx)
	return err
}

func (s *Store) CreateTicket(ctx context.Context, docID string, rec TicketRecord) (string, error) {
	ref, _, err := s.client.Collection("documents").Doc(docID).
		Collection("tickets").Add(ctx, rec)
	if err != nil {
		return "", err
	}
	return ref.ID, nil
}

func (s *Store) GetTicket(ctx context.Context, docID, ticketID string) (*TicketRecord, error) {
	snap, err := s.client.Collection("documents").Doc(docID).
		Collection("tickets").Doc(ticketID).Get(ctx)
	if err != nil {
		return nil, err
	}
	var rec TicketRecord
	if err := snap.DataTo(&rec); err != nil {
		return nil, err
	}
	rec.ID = snap.Ref.ID
	return &rec, nil
}

func (s *Store) ListTickets(ctx context.Context, docID string) ([]TicketRecord, error) {
	docs, err := s.client.Collection("documents").Doc(docID).Collection("tickets").
		OrderBy("createdAt", firestore.Desc).Documents(ctx).GetAll()
	if err != nil {
		return nil, err
	}
	result := make([]TicketRecord, 0, len(docs))
	for _, d := range docs {
		var rec TicketRecord
		if err := d.DataTo(&rec); err != nil {
			return nil, err
		}
		rec.ID = d.Ref.ID
		result = append(result, rec)
	}
	return result, nil
}

func (s *Store) UpdateTicketFields(ctx context.Context, docID, ticketID string, fields map[string]any) error {
	updates := make([]firestore.Update, 0, len(fields))
	for k, v := range fields {
		updates = append(updates, firestore.Update{Path: k, Value: v})
	}
	_, err := s.client.Collection("documents").Doc(docID).
		Collection("tickets").Doc(ticketID).Update(ctx, updates)
	return err
}

func (s *Store) DeleteTicket(ctx context.Context, docID, ticketID string) error {
	_, err := s.client.Collection("documents").Doc(docID).
		Collection("tickets").Doc(ticketID).Delete(ctx)
	return err
}

// UpdateDocFields patches arbitrary top-level fields on documents/{docID}.
func (s *Store) UpdateDocFields(ctx context.Context, docID string, fields map[string]any) error {
	updates := make([]firestore.Update, 0, len(fields))
	for k, v := range fields {
		updates = append(updates, firestore.Update{Path: k, Value: v})
	}
	_, err := s.client.Collection("documents").Doc(docID).Update(ctx, updates)
	return err
}
