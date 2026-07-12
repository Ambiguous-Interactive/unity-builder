# Return the active Unity license

Write-Output ""
Write-Output "###########################"
Write-Output "#      Return License     #"
Write-Output "###########################"
Write-Output ""

if (($null -ne ${env:UNITY_LICENSING_SERVER}))
{
  Write-Output "Returning floating license: ""$env:FLOATING_LICENSE"""
  Start-Process -FilePath "$Env:UNITY_PATH\Editor\Data\Resources\Licensing\Client\Unity.Licensing.Client.exe" `
                -ArgumentList "--return-floating ""$env:FLOATING_LICENSE"" " `
                -NoNewWindow `
                -Wait
}

elseif (($null -ne ${env:UNITY_SERIAL}) -and ($null -ne ${env:UNITY_EMAIL}) -and ($null -ne ${env:UNITY_PASSWORD}))
{
  #
  # SERIAL LICENSE MODE
  #
  # This will return the license that is currently in use.
  #
  if (-not [string]::IsNullOrWhiteSpace($env:UNITY_BUILDER_RESOURCE_PROOF_PATH))
  {
    try
    {
      Remove-Item -LiteralPath $env:UNITY_BUILDER_RESOURCE_PROOF_PATH -Force -ErrorAction Stop
    }
    catch [System.Management.Automation.ItemNotFoundException]
    {
      # Expected for a fresh current-attempt proof path.
    }
    catch
    {
      Write-Output "::warning::Stale cleanup proof could not be removed; proof is disabled for this attempt."
      $env:UNITY_BUILDER_RESOURCE_PROOF_NONCE = ""
    }
  }
  $RETURN_LICENSE_OUTPUT = $null
  try
  {
    $RETURN_LICENSE_OUTPUT = Start-Process -FilePath "$Env:UNITY_PATH/Editor/Unity.exe" `
                                           -NoNewWindow `
                                           -PassThru `
                                           -ErrorAction Stop `
                                           -ArgumentList "-batchmode `
                                                           -quit `
                                                           -nographics `
                                                           -username $Env:UNITY_EMAIL `
                                                           -password $Env:UNITY_PASSWORD `
                                                           -returnlicense `
                                                           -projectPath c:/BlankProject `
                                                           -logfile -"
  }
  catch
  {
    Write-Output "::warning::Unity license return could not be started; cleanup is unconfirmed."
  }

  if ($null -ne $RETURN_LICENSE_OUTPUT)
  {
    try
    {
      # Cache the handle so exit code works properly.
      $unityHandle = $RETURN_LICENSE_OUTPUT.Handle
      $returnDeadline = [DateTime]::UtcNow.AddSeconds(120)
      while (-not $RETURN_LICENSE_OUTPUT.HasExited -and [DateTime]::UtcNow -lt $returnDeadline)
      {
        Start-Sleep -Seconds 1
      }

      if (-not $RETURN_LICENSE_OUTPUT.HasExited)
      {
        Write-Output "::warning::Unity license return exceeded 120 seconds; cleanup is unconfirmed."
        try { $RETURN_LICENSE_OUTPUT.Kill() } catch { }
      }
      else
      {
        $RETURN_LICENSE_EXIT_CODE = $RETURN_LICENSE_OUTPUT.ExitCode
        if ($RETURN_LICENSE_EXIT_CODE -eq 0)
        {
          Write-Output "License Return Succeeded"
          if (
            -not [string]::IsNullOrWhiteSpace($env:UNITY_BUILDER_RESOURCE_PROOF_NONCE) -and
            -not [string]::IsNullOrWhiteSpace($env:UNITY_BUILDER_RESOURCE_PROOF_PATH)
          )
          {
            try
            {
              [System.IO.File]::WriteAllText(
                $env:UNITY_BUILDER_RESOURCE_PROOF_PATH,
                "resource-safe=$env:UNITY_BUILDER_RESOURCE_PROOF_NONCE"
              )
            }
            catch
            {
              Write-Output "::warning::License returned, but cleanup proof could not be persisted."
            }
          }
        }
        else
        {
          Write-Output "License Return failed, with exit code $RETURN_LICENSE_EXIT_CODE"
          Write-Output "::warning ::License Return failed! If this is a Pro License you might need to manually `
 free the seat in your Unity admin panel or you might run out of seats to activate with."
        }
      }
    }
    catch
    {
      Write-Output "::warning::Unity license return monitoring failed; cleanup is unconfirmed."
    }
    finally
    {
      try { $RETURN_LICENSE_OUTPUT.Dispose() } catch { }
    }
  }
}
