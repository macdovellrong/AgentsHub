namespace AgentHub.Native.Core.Input;

public static class InputSubmissionGesture
{
    public static InputSubmissionAction Resolve(bool isEnterKey, bool isShiftDown)
    {
        if (!isEnterKey)
        {
            return InputSubmissionAction.Ignore;
        }

        return isShiftDown
            ? InputSubmissionAction.InsertNewline
            : InputSubmissionAction.Submit;
    }
}
