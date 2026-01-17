# Cloudflare RealtimeKit Audio Integration

This spec defines the integration of Cloudflare RealtimeKit UI components for audio chat in the PestCall customer dashboard. It builds on the existing workflow architecture in [`cloudflare-workflows.md`](./cloudflare-workflows.md) while focusing specifically on the front-end audio experience.

## Purpose

Replace the text-based chat interface in the customer dashboard with a real-time audio chat experience using Cloudflare RealtimeKit components. The audio interface should provide seamless voice communication while maintaining all existing workflow capabilities and customer management features.

## Goals

- Integrate RealtimeKit UI components into the customer page
- Replace text chat with audio chat while preserving sidebar functionality
- Maintain existing customer selection and session management
- Ensure audio chat works with existing workflow orchestration
- Provide visual feedback for audio states (connecting, speaking, listening)

## Non-goals

- Modifying existing agent backend logic or workflows
- Changing the customer selection or session management UX
- Implementing new authentication flows

## Current State

The customer page (`apps/web/src/app/customer/page.tsx`) currently provides:
- Text-based chat interface with message history
- Customer selection via sidebar
- Session status and logs
- Integration with conversation sessions via WebSockets

## Target Architecture

### UI Structure

The customer page will have two modes accessible via tabs:
1. **Text Chat** (existing functionality)
2. **Audio Chat** (new RealtimeKit integration)

```
┌─────────────────────────────────────────────────┐
│ Nav Bar                                         │
├─────────────────┬───────────────────────────────┤
│ Sidebar         │ Main Content Area             │
│ (Customer       │ ┌─────────────────────────┐ │
│  Selection,     │ │ [Text] [Audio]         │ │
│  Status, Logs)  │ ├─────────────────────────┤ │
│                 │ │                         │ │
│                 │ │   Audio Chat Interface  │ │
│                 │ │   (RealtimeKit)        │ │
│                 │ │                         │ │
│                 │ └─────────────────────────┘ │
└─────────────────┴───────────────────────────────┘
```

### Audio Chat Components

Based on the [RealtimeKit Component Library](https://developers.cloudflare.com/realtime/realtimekit/ui-kit/component-library/), we'll integrate:

#### Core Components
- `RtkMeeting` - Main meeting interface container
- `RtkParticipantTile` - Display agent participant
- `RtkControlbar` - Audio controls (mute, hang up, etc.)
- `RtkSettingsAudio` - Audio settings panel

#### Layout Components
- `RtkGrid` or `RtkSimpleGrid` - Participant layout
- `RtkSidebar` - Could integrate with existing sidebar or overlay

#### Status Components
- `RtkRecordingIndicator` - Show when conversation is recorded
- `RtkParticipantCount` - Display participants (agent + customer)
- `RtkSpinner` - Loading states

## Integration Points

### Customer Page Modifications

1. **Add Audio/Text Toggle**
   - Add tab navigation in main content area
   - Preserve existing sidebar functionality
   - Maintain session management hooks

2. **Audio Chat Container**
   - Conditionally render audio interface based on active tab
   - Pass customer context to audio components
   - Handle audio session lifecycle alongside existing conversation session

3. **Session Integration**
   - Audio chat should work with existing `useConversationSession` hook
   - Maintain message logging and status updates
   - Preserve workflow integration (verification, reschedule, etc.)

### Component Integration

```typescript
// Example integration in customer/page.tsx
function CustomerPage() {
  const [chatMode, setChatMode] = useState<'text' | 'audio'>('text');

  return (
    <div className="flex">
      {/* Existing sidebar */}
      <Sidebar />

      {/* Main content with tabs */}
      <main>
        <div className="tabs">
          <button onClick={() => setChatMode('text')}>Text Chat</button>
          <button onClick={() => setChatMode('audio')}>Audio Chat</button>
        </div>

        {chatMode === 'text' ? (
          <TextChatInterface />
        ) : (
          <AudioChatInterface customer={selectedCustomer} />
        )}
      </main>
    </div>
  );
}
```

### Audio Interface Component

Create `apps/web/src/app/customer/components/AudioChatInterface.tsx`:

```typescript
interface AudioChatInterfaceProps {
  customer: Customer;
  sessionId: string;
  onStatusChange: (status: string) => void;
}

function AudioChatInterface({ customer, sessionId, onStatusChange }: AudioChatInterfaceProps) {
  return (
    <div className="audio-chat-container">
      <RtkMeeting
        roomName={sessionId}
        participantName={customer.name}
        onMeetingStateChange={(state) => onStatusChange(state)}
      >
        <RtkSimpleGrid>
          <RtkParticipantTile participantId="agent" />
          <RtkParticipantTile participantId="customer" isLocal />
        </RtkSimpleGrid>

        <RtkControlbar>
          <RtkControlbarButton icon="microphone" />
          <RtkControlbarButton icon="hangup" />
        </RtkControlbar>
      </RtkMeeting>
    </div>
  );
}
```

## Workflow Integration

Audio chat must integrate with existing workflows:

### Verification Workflow
- Audio interface should handle ZIP code collection via voice
- Visual feedback during verification steps
- Maintain workflow state persistence

### Reschedule/Cancel Workflows
- Audio prompts for appointment selection
- Voice confirmation for actions
- Status updates in sidebar

### Session Management
- Audio sessions should align with conversation session lifecycle
- WebSocket integration for real-time updates
- Call session logging and recording

## Technical Implementation

### Dependencies
Add to `apps/web/package.json`:
```json
{
  "@cloudflare/realtimekit": "^1.0.0"
}
```

### Environment Configuration
Add RealtimeKit configuration to environment:
- Room configuration
- Authentication tokens
- Audio settings

### State Management
- Integrate audio session state with existing conversation hooks
- Handle audio-specific events (mute, unmute, disconnect)
- Maintain compatibility with text chat state management

## User Experience

### Audio Chat Flow
1. User selects customer and clicks "Audio Chat" tab
2. System establishes audio connection
3. Agent greeting plays automatically
4. User can speak naturally about their pest control needs
5. Visual indicators show connection status and agent responses
6. Workflows proceed with voice prompts and confirmations

### Visual Feedback
- Connection status indicator
- Mute/unmute button states
- Participant speaking indicators
- Recording status (if applicable)

### Error Handling
- Connection failures with retry options
- Audio permission denied handling
- Fallback to text chat if audio unavailable

## Testing Strategy

### Unit Tests
- Audio component rendering
- State transitions
- Event handling

### Integration Tests
- End-to-end audio session establishment
- Workflow integration with audio input
- Customer selection and session management

### Manual Testing
- Audio quality and latency
- Browser compatibility
- Mobile device support

## Success Metrics

- Audio connection success rate > 95%
- Average call setup time < 3 seconds
- User preference for audio vs text chat
- Workflow completion rates maintained

## References

- [RealtimeKit Component Library](https://developers.cloudflare.com/realtime/realtimekit/ui-kit/component-library/)
- [Existing Workflows Spec](./cloudflare-workflows.md)
- [Customer Page Implementation](../apps/web/src/app/customer/page.tsx)