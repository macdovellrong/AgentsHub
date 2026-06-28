using AgentHub.Native.Core.Input;

namespace AgentHub.Native.Core.Tests;

public sealed class InputSubmissionGestureTests
{
    [Theory]
    [InlineData(true, false, InputSubmissionAction.Submit)]
    [InlineData(true, true, InputSubmissionAction.InsertNewline)]
    [InlineData(false, false, InputSubmissionAction.Ignore)]
    [InlineData(false, true, InputSubmissionAction.Ignore)]
    public void Resolves_enter_and_shift_enter_actions(
        bool isEnterKey,
        bool isShiftDown,
        InputSubmissionAction expectedAction)
    {
        Assert.Equal(expectedAction, InputSubmissionGesture.Resolve(isEnterKey, isShiftDown));
    }
}
