//! `read`: what each session's Claude is doing, from the file Claude Code
//! keeps for every running session, `<config>/sessions/<pid>.json`
//! (measured on Claude Code 2.1.285, 2026-10-23).

use std::path::Path;

use fleet_adapter_sdk::agent::{Activity, Read, Readings, Reason};
use fleet_adapter_sdk::kit::agent::{self, StatusFile};
use serde::Deserialize;

/// The fields of a session file this adapter reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    pid: u32,
    status: String,
    #[serde(default)]
    waiting_for: Option<String>,
}

/// What each session's Claude is doing. No file for its pid yet, or one
/// left by another process, means it is still starting; a file that cannot
/// be read or does not read, or a status this adapter does not know, is
/// unknown.
pub(crate) fn readings(config: &Path, request: &Read) -> Readings {
    let dir = config.join("sessions");
    agent::readings(request, |session| {
        match agent::status_file(&dir, session.pid, |f: &SessionFile| f.pid) {
            StatusFile::NotYet | StatusFile::Stale => (Activity::Starting, None),
            StatusFile::Broken => (Activity::Unknown, None),
            StatusFile::Read(file) => activity(&file),
        }
    })
}

fn activity(file: &SessionFile) -> (Activity, Option<Reason>) {
    match file.status.as_str() {
        "busy" => (Activity::Working, None),
        "idle" => (Activity::Idle, None),
        "waiting" => {
            let on = file.waiting_for.as_deref().unwrap_or_default();
            let reason = if on.contains("permission") {
                Some(Reason::Permission)
            } else if on.contains("input") {
                Some(Reason::Question)
            } else {
                None
            };
            (Activity::NeedsYou, reason)
        }
        _ => (Activity::Unknown, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io;

    use fleet_adapter_sdk::agent::{Activity, Read, Reason, SessionRef};
    use fleet_adapter_sdk::kit::testing::TempDir;

    /// A Claude config directory of the test's own, with its sessions
    /// directory.
    fn config() -> io::Result<TempDir> {
        let dir = TempDir::new("claude-config")?;
        fs::create_dir_all(dir.path().join("sessions"))?;
        Ok(dir)
    }

    /// What `readings` says of one session, pid `pid`.
    fn read(config: &TempDir, pid: u32) -> (String, Activity, Option<Reason>) {
        let request = Read {
            sessions: vec![SessionRef {
                session: "s1".into(),
                pid,
                directory: "/c/app".into(),
            }],
        };
        let mut r = readings(config.path(), &request).sessions;
        r.pop().map_or_else(
            || (String::new(), Activity::Unknown, None),
            |r| (r.session, r.activity, r.reason),
        )
    }

    /// What `readings` says of pid `pid` when its file holds `json`.
    fn with_file(pid: u32, json: &str) -> io::Result<(Activity, Option<Reason>)> {
        let c = config()?;
        fs::write(c.path().join("sessions").join(format!("{pid}.json")), json)?;
        let (_, activity, reason) = read(&c, pid);
        Ok((activity, reason))
    }

    #[test]
    fn busy_is_working_and_idle_is_idle() -> io::Result<()> {
        assert_eq!(
            with_file(41, r#"{"pid":41,"status":"busy"}"#)?,
            (Activity::Working, None)
        );
        assert_eq!(
            with_file(42, r#"{"pid":42,"status":"idle"}"#)?,
            (Activity::Idle, None)
        );
        Ok(())
    }

    #[test]
    fn a_reading_names_the_session_asked_about() -> io::Result<()> {
        let c = config()?;
        assert_eq!(read(&c, 40).0, "s1");
        Ok(())
    }

    #[test]
    fn waiting_on_a_permission_prompt_needs_you_for_permission() -> io::Result<()> {
        assert_eq!(
            with_file(
                43,
                r#"{"pid":43,"status":"waiting","waitingFor":"permission prompt"}"#
            )?,
            (Activity::NeedsYou, Some(Reason::Permission))
        );
        Ok(())
    }

    #[test]
    fn waiting_for_input_needs_you_for_a_question() -> io::Result<()> {
        assert_eq!(
            with_file(
                44,
                r#"{"pid":44,"status":"waiting","waitingFor":"input needed"}"#
            )?,
            (Activity::NeedsYou, Some(Reason::Question))
        );
        Ok(())
    }

    #[test]
    fn waiting_for_something_else_needs_you_without_a_reason() -> io::Result<()> {
        assert_eq!(
            with_file(45, r#"{"pid":45,"status":"waiting"}"#)?,
            (Activity::NeedsYou, None)
        );
        Ok(())
    }

    #[test]
    fn no_file_yet_is_starting() -> io::Result<()> {
        let c = config()?;
        assert_eq!(read(&c, 46).1, Activity::Starting);
        Ok(())
    }

    #[test]
    fn a_file_for_another_pid_is_starting() -> io::Result<()> {
        assert_eq!(
            with_file(47, r#"{"pid":99,"status":"busy"}"#)?.0,
            Activity::Starting
        );
        Ok(())
    }

    #[test]
    fn an_unknown_status_or_a_broken_file_is_unknown() -> io::Result<()> {
        assert_eq!(
            with_file(48, r#"{"pid":48,"status":"dreaming"}"#)?.0,
            Activity::Unknown
        );
        assert_eq!(with_file(49, "{not json")?.0, Activity::Unknown);
        Ok(())
    }

    #[test]
    fn a_file_that_cannot_be_read_is_unknown() -> io::Result<()> {
        let c = config()?;
        fs::create_dir(c.path().join("sessions").join("50.json"))?;
        assert_eq!(read(&c, 50).1, Activity::Unknown);
        Ok(())
    }
}
